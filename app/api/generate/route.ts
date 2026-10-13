import { z } from 'zod';
import { produceGeneration, sourceTextOf } from '@/lib/creator/produce';
import { getDb } from '@/lib/db/client';
import { generationProvider } from '@/lib/security/config';
import { getCachedContent, saveContent, subjectOf } from '@/lib/security/content';
import { NotConfiguredError, runProtected } from '@/lib/security/gate';
import { crossSite, denialResponse, DISCOVERY_ID, jsonError, jsonOk, readJson } from '@/lib/security/http';
import { getFeedData } from '@/lib/server/data';
import { limited } from '@/lib/server/rate-limit';
import { isSupportedLanguage, SOURCE_LANGUAGE } from '@/lib/translation/languages';
import { contentVersionOf } from '@/lib/translation/service';
import type { DiscoveryView } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    discoveryId: z.string().regex(DISCOVERY_ID),
    kind: z.enum(['explanation', 'story', 'draft']),
    // A short slug such as `linkedin:conversational`. Free text here would be a cache-busting and injection channel.
    variant: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,39}$/).optional(),
    language: z.string().min(2).max(16).optional(),
  })
  .strict();

/** Largest generated payload that will be stored or returned, as serialised JSON. */
const MAX_PAYLOAD_CHARS = 60_000;
/** Allowance for the generated text when reserving budget, on top of the source sent. */
const OUTPUT_ALLOWANCE = 4_000;

/**
 * POST /api/generate { discoveryId, kind, variant?, language? }
 * A stored result is returned to anyone. A new one needs a signed-in user and
 * passes every check in lib/security/gate.ts.
 */
export async function POST(request: Request) {
  const blocked = limited(request.headers) ?? crossSite(request);
  if (blocked) return blocked;
  const body = await readJson(request, Body);
  if (!body.ok) return body.response;
  const { discoveryId, kind } = body.data;
  const variant = body.data.variant ?? '';
  const language = body.data.language ?? SOURCE_LANGUAGE;
  const env = process.env;
  if (!isSupportedLanguage(language, env)) return jsonError(400, 'unsupported_language', 'That language is not available.');

  let view: DiscoveryView | undefined;
  try {
    view = (await getFeedData()).views.find((v) => v.id === discoveryId);
  } catch {
    return jsonError(503, 'unavailable', 'Discovery data is temporarily unavailable.', 30);
  }
  if (!view) return jsonError(404, 'not_found', 'Discovery not found.');

  const source = sourceTextOf(view);
  const subject = subjectOf(view.id);
  const contentVersion = contentVersionOf(source);
  const identity = { kind, subject, contentVersion, language, variant };
  const respond = (result: { payload: unknown; provider: string; model: string; cached: boolean }) =>
    jsonOk({ kind, variant, language, payload: result.payload, provider: result.provider, model: result.model, cached: result.cached, contentVersion });

  try {
    const db = await getDb();
    const provider = generationProvider(env);
    if (!provider) {
      // Nothing can be generated now, but what was generated before is still readable.
      const stored = await getCachedContent(db, identity);
      if (stored) return respond({ ...stored, cached: true });
      return jsonError(501, 'not_configured', 'Generation is not available on this deployment.');
    }

    const result = await runProtected<unknown>(
      db,
      {
        request, env, now: new Date(), kind, subject,
        cacheKeyParts: [contentVersion, language, variant],
        inputChars: source.length,
        estimateUnits: source.length + OUTPUT_ALLOWANCE,
        provider,
        fetchCached: () => getCachedContent(db, identity),
        save: (done, user) => saveContent(db, { ...identity, provider: done.provider, model: done.model, payload: done.payload, createdBy: user.id }),
      },
      async () => {
        const done = await produceGeneration({ kind, view, variant, language }, env);
        if (!done) throw new NotConfiguredError();
        if (JSON.stringify(done.payload ?? null).length > MAX_PAYLOAD_CHARS) throw new Error('generated payload is too large');
        return done;
      },
    );
    return result.ok ? respond(result) : denialResponse(result);
  } catch {
    return jsonError(503, 'unavailable', 'Generation is temporarily unavailable.', 30);
  }
}
