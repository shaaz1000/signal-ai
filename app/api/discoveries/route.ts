import { parseQuery, queryFeed, PAGE_SIZE } from '@/lib/feed/query';
import { SCOPES, type ScopeConfig, type ScopeId } from '@/lib/feed/scopes';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { getFeedData } from '@/lib/server/data';
import { API_CACHE, limited } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

/** GET /api/discoveries?scope=&q=&category=&sort=&window=&language=&age=&activity=&page= */
export async function GET(request: Request) {
  const blocked = limited(request.headers);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const scopeId = (Object.keys(SCOPES).includes(params.scope) ? params.scope : 'discover') as ScopeId;
  const config: ScopeConfig = SCOPES[scopeId];
  try {
    const data = await getFeedData();
    const query = parseQuery(params, config.defaults);
    // The page components use "show more" (cumulative); the API returns one page at a time.
    const all = queryFeed(data.views, { ...query, page: 50 }, new Date(), DEFAULT_PREFS, { ...config, pageSize: PAGE_SIZE });
    const start = (query.page - 1) * PAGE_SIZE;
    return Response.json(
      { scope: scopeId, query, total: all.total, page: query.page, pageCount: all.pageCount, pageSize: PAGE_SIZE, items: all.items.slice(start, start + PAGE_SIZE), generatedAt: data.status.generatedAt },
      { headers: API_CACHE },
    );
  } catch {
    return Response.json({ error: 'Discovery data is temporarily unavailable.' }, { status: 503, headers: { 'retry-after': '30' } });
  }
}
