/**
 * Fixed-window rate limit for the public JSON endpoints. State is per server
 * instance, which bounds abuse of one instance; a shared store (Redis,
 * Upstash) is the upgrade path for multi-instance deployments.
 */
const WINDOW_MS = 60_000;
// Requests per minute per client. Overridable so load tests and trusted internal callers can raise it.
const LIMIT = Math.max(1, Number(process.env.API_RATE_LIMIT) || 60);
const hits = new Map<string, { count: number; resetAt: number }>();

export function clientKey(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}

export function rateLimit(key: string, now = Date.now(), limit = LIMIT): { ok: boolean; remaining: number; retryAfter: number } {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  entry.count++;
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count), retryAfter };
}

export function resetRateLimit(): void {
  hits.clear();
}

export function limited(headers: Headers): Response | null {
  const result = rateLimit(clientKey(headers));
  if (result.ok) return null;
  return Response.json({ error: 'Too many requests. Try again shortly.' }, { status: 429, headers: { 'retry-after': String(result.retryAfter) } });
}

export const API_CACHE = { 'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' };
