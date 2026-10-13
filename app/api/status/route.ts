import { getFeedData } from '@/lib/server/data';
import { API_CACHE, limited } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const blocked = limited(request.headers);
  if (blocked) return blocked;
  try {
    return Response.json((await getFeedData()).status, { headers: API_CACHE });
  } catch {
    return Response.json({ error: 'Status is temporarily unavailable.' }, { status: 503, headers: { 'retry-after': '30' } });
  }
}
