import { z } from 'zod';
import { sourceTextOf } from '@/lib/creator/produce';
import { getDb } from '@/lib/db/client';
import { subjectOf } from '@/lib/security/content';
import { runProtected } from '@/lib/security/gate';
import { crossSite, denialResponse, DISCOVERY_ID, jsonError, jsonOk, readJson } from '@/lib/security/http';
import { getFeedData } from '@/lib/server/data';
import { limited } from '@/lib/server/rate-limit';
import { getLanguage, isSupportedLanguage, SOURCE_LANGUAGE } from '@/lib/translation/languages';
import { resolveTranslationProvider } from '@/lib/translation/provider';
import { contentVersionOf, getCachedTranslation, protectedTermsOf, saveTranslation, translatableFields, translateFields, type TranslatedFields } from '@/lib/translation/service';
import type { DiscoveryView } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ discoveryId: z.string().regex(DISCOVERY_ID), language: z.string().min(2).max(16) }).strict();

/**
 * POST /api/translate { discoveryId, language }
 * A stored translation is returned to anyone. A new one needs a signed-in
 * user and passes every check in lib/security/gate.ts.
 */
export async function POST(request: Request) {
  const blocked = limited(request.headers) ?? crossSite(request);
  if (blocked) return blocked;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;
  const { discoveryId, language } = body.data;
  const env = process.env;
  if (language === SOURCE_LANGUAGE || !isSupportedLanguage(language, env)) return jsonError(400, 'unsupported_language', 'That language is not available.');

  let view: DiscoveryView | undefined;
  try {
    view = (await getFeedData()).views.find((v) => v.id === discoveryId);
  } catch {
    return jsonError(503, 'unavailable', 'Discovery data is temporarily unavailable.', 30);
  }
  if (!view) return jsonError(404, 'not_found', 'Discovery not found.');

  const fields = translatableFields(view);
  const subject = subjectOf(view.id);
  const contentVersion = contentVersionOf(sourceTextOf(view));
  const dir = getLanguage(language)?.dir ?? 'ltr';
  const respond = (result: { payload: TranslatedFields; provider: string; model: string; cached: boolean }) =>
    jsonOk({ fields: result.payload, language, dir, provider: result.provider, model: result.model, cached: result.cached, contentVersion });

  try {
    const db = await getDb();
    const provider = resolveTranslationProvider(env);
    if (!provider) {
      // Nothing can be translated now, but what was translated before is still readable.
      const stored = await getCachedTranslation(db, { subject, contentVersion, language });
      if (stored) return respond({ ...stored, cached: true });
      return jsonError(501, 'not_configured', 'Translation is not available on this deployment.');
    }

    const inputChars = Object.values(fields).reduce((sum, text) => sum + text.length, 0);
    const identity = { subject, contentVersion, language, provider: provider.name, model: provider.model };
    const result = await runProtected<TranslatedFields>(
      db,
      {
        request, env, now: new Date(), kind: 'translation', subject,
        cacheKeyParts: [contentVersion, language, provider.name, provider.model],
        inputChars,
        // The text goes out once and comes back once, usually a little longer.
        estimateUnits: Math.ceil(inputChars * 2.5),
        provider: provider.name,
        fetchCached: () => getCachedTranslation(db, identity),
        save: (done, user) => saveTranslation(db, { ...identity, fields: done.payload, createdBy: user.id }),
      },
      async (signal) => {
        const done = await translateFields(db, { subject, contentVersion, fields, sourceLanguage: 'en', targetLanguage: language, provider, terms: protectedTermsOf(view), signal });
        // The record is stored under the configured model; a different one would never be found again.
        if (done.model !== provider.model) throw new Error('translation came from an unexpected model');
        return { payload: done.fields, provider: done.provider, model: done.model, units: done.units };
      },
    );
    return result.ok ? respond(result) : denialResponse(result);
  } catch {
    return jsonError(503, 'unavailable', 'Translation is temporarily unavailable.', 30);
  }
}
