/**
 * Outbound HTTP for ingestion workers: timeouts, bounded retries with
 * exponential backoff and jitter, Retry-After / GitHub rate-limit handling,
 * and a response size cap. `fetchImpl` and `sleep` are injectable for tests.
 */

export const USER_AGENT = `signal-ai/0.1 (+${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://github.com/signal-ai'})`;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number | null,
    readonly rateLimited = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface HttpOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'HEAD' | 'POST';
  body?: string;
  timeoutMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  /** Longest single wait we accept. A longer Retry-After fails fast instead. */
  maxBackoffMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  redirect?: RequestRedirect;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
  url: string;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  // Full jitter keeps concurrent workers from retrying in lockstep.
  return Math.round(exp / 2 + (exp / 2) * random());
}

/** Reads Retry-After (seconds or HTTP date) and GitHub's reset header. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const ra = headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now) + 500;
  }
  return null;
}

function isRateLimited(status: number, headers: Headers): boolean {
  return status === 429 || (status === 403 && headers.get('x-ratelimit-remaining') === '0');
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function request(url: string, opts: HttpOptions = {}): Promise<HttpResponse> {
  const {
    headers = {},
    method = 'GET',
    body,
    timeoutMs = 15_000,
    retries = 3,
    backoffBaseMs = 500,
    maxBackoffMs = 20_000,
    maxBytes = 3_000_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    redirect = 'follow',
  } = opts;

  let lastError: HttpError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        body,
        redirect,
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
      });
      if (res.ok || (res.status >= 300 && res.status < 400)) {
        const text = method === 'HEAD' ? '' : await readCapped(res, maxBytes);
        return { status: res.status, headers: res.headers, text, url: res.url || url };
      }
      const limited = isRateLimited(res.status, res.headers);
      const wait = retryAfterMs(res.headers);
      lastError = new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, url, res.status, limited, wait);
      await res.body?.cancel().catch(() => undefined);
      if (!limited && !RETRYABLE.has(res.status)) throw lastError;
      if (attempt === retries) throw lastError;
      // A long server-requested wait would stall the whole run; fail this provider instead.
      if (wait !== null && wait > maxBackoffMs) throw lastError;
      await sleep(wait ?? backoffDelay(attempt, backoffBaseMs, maxBackoffMs));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastError = new HttpError(
        aborted ? `Timed out after ${timeoutMs}ms: ${new URL(url).host}` : `Network error: ${(err as Error).message}`,
        url,
        null,
      );
      if (attempt === retries) throw lastError;
      await sleep(backoffDelay(attempt, backoffBaseMs, maxBackoffMs));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new HttpError('Request failed', url, null);
}

export async function getJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new HttpError(`Malformed JSON from ${new URL(url).host}`, url, res.status);
  }
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  return (await request(url, opts)).text;
}
