import { sourceTextOf } from '@/lib/creator/produce';
import { getDb } from '@/lib/db/client';
import { listContent, subjectOf } from '@/lib/security/content';
import { DISCOVERY_ID, jsonError } from '@/lib/security/http';
import { getFeedData } from '@/lib/server/data';
import { limited } from '@/lib/server/rate-limit';
import { getLanguage, isSupportedLanguage } from '@/lib/translation/languages';
import { contentVersionOf } from '@/lib/translation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/content/[id]?language=
 * Every stored translation and generation for a discovery, at the current
 * version of its source text. Public: reading what exists never needs sign-in.
 * Records made from an earlier version of the source are not returned.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = limited(request.headers);
  if (blocked) return blocked;
  const { id } = await params;
  if (!DISCOVERY_ID.test(id)) return jsonError(400, 'invalid_request', 'Invalid discovery id.');
  const language = new URL(request.url).searchParams.get('language') ?? undefined;
  if (language !== undefined && !isSupportedLanguage(language, process.env)) return jsonError(400, 'unsupported_language', 'That language is not available.');
  try {
    const view = (await getFeedData()).views.find((v) => v.id === id);
    if (!view) return jsonError(404, 'not_found', 'Discovery not found.');
    const contentVersion = contentVersionOf(sourceTextOf(view));
    const rows = await listContent(await getDb(), { subject: subjectOf(id), contentVersion, language });
    return Response.json(
      {
        id,
        contentVersion,
        items: rows.map((r) => ({
          kind: r.kind, language: r.language, dir: getLanguage(r.language)?.dir ?? 'ltr', variant: r.variant,
          provider: r.provider, model: r.model, contentVersion: r.contentVersion, payload: r.payload, createdAt: r.createdAt.toISOString(),
        })),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return jsonError(503, 'unavailable', 'Generated content is temporarily unavailable.', 30);
  }
}
