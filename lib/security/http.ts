/** Shared request and response handling for the protected API routes. */
import type { z } from 'zod';
import type { Denial } from './gate';

const NO_STORE = { 'cache-control': 'no-store' };

/** JSON error body `{ error, code }`. Never carries a stack trace or anything a provider said. */
export function jsonError(status: number, code: string, message: string, retryAfter?: number, headers: Record<string, string> = {}): Response {
  return Response.json({ error: message, code }, { status, headers: { ...NO_STORE, ...(retryAfter ? { 'retry-after': String(retryAfter) } : {}), ...headers } });
}

export function denialResponse(denial: Denial): Response {
  return jsonError(denial.status, denial.code, denial.message, denial.retryAfter);
}

export function jsonOk(body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { headers: { ...NO_STORE, ...headers } });
}

/**
 * Rejects a browser request that another site caused. The session cookie is
 * SameSite=Lax, which already keeps it off cross-site POSTs; this is the
 * second check. Requests with no Origin header (server-to-server, curl) pass,
 * since they carry no ambient cookie a third party could abuse.
 */
export function crossSite(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    // An unparseable Origin is treated as foreign.
  }
  return jsonError(403, 'forbidden', 'Cross-site requests are not accepted.');
}

async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Reads and validates a small JSON body. The size cap is enforced while
 * reading, so a large body is abandoned rather than buffered. Runs before any
 * sign-in or database work.
 */
export async function readJson<S extends z.ZodType>(request: Request, schema: S, maxBytes = 2048): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const tooLarge = () => ({ ok: false as const, response: jsonError(413, 'payload_too_large', 'The request body is too large.') });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  let text: string | null;
  try {
    text = await readCapped(request, maxBytes);
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', 'The request body could not be read.') };
  }
  if (text === null) return tooLarge();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', 'The request body must be valid JSON.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: jsonError(400, 'invalid_request', 'The request is missing a field or has a field of the wrong shape.') };
  return { ok: true, data: parsed.data };
}

export const DISCOVERY_ID = /^[a-f0-9]{12}$/;
