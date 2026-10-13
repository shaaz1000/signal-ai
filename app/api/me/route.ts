import { getDb } from '@/lib/db/client';
import { authSecret, getCurrentUser } from '@/lib/security/auth';
import { generationProvider, limitsFor, PAID_KINDS, type Limits } from '@/lib/security/config';
import { generationDisabled } from '@/lib/security/flags';
import { usageKeys } from '@/lib/security/gate';
import { jsonOk } from '@/lib/security/http';
import { peek } from '@/lib/security/quota';
import { limited } from '@/lib/server/rate-limit';
import { enabledLanguages } from '@/lib/translation/languages';
import { resolveTranslationProvider } from '@/lib/translation/provider';
import { DAY } from '@/lib/utils/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/me
 * Who is signed in, what they may still do, and whether generation and
 * translation can run at all, so the interface offers only what will work.
 * Anything that cannot be determined is reported as unavailable.
 */
export async function GET(request: Request) {
  const blocked = limited(request.headers);
  if (blocked) return blocked;
  const env = process.env;
  const now = new Date();
  const languages = enabledLanguages(env).map(({ code, name, nativeName, dir }) => ({ code, name, nativeName, dir }));
  const signInAvailable = authSecret(env) !== null;
  const closed = { signedIn: false, signInAvailable, generationAvailable: false, translationAvailable: false, languages };

  let limits: Limits;
  try {
    limits = limitsFor(null, env);
  } catch {
    return jsonOk(closed);
  }

  try {
    const db = await getDb();
    const enabled = signInAvailable && !(await generationDisabled(db, env));
    const availability = {
      signInAvailable,
      generationAvailable: enabled && generationProvider(env) !== null,
      translationAvailable: enabled && resolveTranslationProvider(env) !== null,
      languages,
    };
    const user = await getCurrentUser(db, request, env, now);
    if (!user) return jsonOk({ signedIn: false, ...availability });

    limits = limitsFor(user.plan, env);
    const usage: Record<string, { used: number; limit: number; remaining: number; resetAt: string }> = {};
    for (const kind of PAID_KINDS) {
      const { limit, windowMs } = limits.perKind[kind];
      const state = await peek(db, { key: usageKeys.rate(kind, user.id), windowMs, limit, now });
      usage[kind] = { used: state.used, limit, remaining: state.remaining, resetAt: state.resetAt.toISOString() };
    }
    const budget = await peek(db, { key: usageKeys.userBudget(user.id), windowMs: DAY, limit: limits.userDailyUnits, now });
    return jsonOk({
      signedIn: true,
      name: user.name,
      plan: user.plan,
      role: user.role,
      limits: {
        translationPerHour: limits.perKind.translation.limit,
        explanationPerHour: limits.perKind.explanation.limit,
        storyPerDay: limits.perKind.story.limit,
        draftPerDay: limits.perKind.draft.limit,
        concurrentJobs: limits.concurrentJobs,
        dailyUnits: limits.userDailyUnits,
        maxInputChars: limits.maxInputChars,
      },
      usage: { ...usage, dailyUnits: { used: budget.used, limit: limits.userDailyUnits, remaining: budget.remaining, resetAt: budget.resetAt.toISOString() } },
      ...availability,
    });
  } catch {
    return jsonOk(closed);
  }
}
