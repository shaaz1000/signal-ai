import { getFeedData } from '@/lib/server/data';
import { API_CACHE, limited } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = limited(request.headers);
  if (blocked) return blocked;
  const { id } = await params;
  if (!/^[a-f0-9]{12}$/.test(id)) return Response.json({ error: 'Invalid discovery id.' }, { status: 400 });
  try {
    const item = (await getFeedData()).views.find((v) => v.id === id);
    if (!item) return Response.json({ error: 'Discovery not found.' }, { status: 404 });
    return Response.json(item, { headers: API_CACHE });
  } catch {
    return Response.json({ error: 'Discovery data is temporarily unavailable.' }, { status: 503, headers: { 'retry-after': '30' } });
  }
}
