import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, getJson, HttpError, request, retryAfterMs } from '@/lib/utils/http';

const URL_UNDER_TEST = 'https://api.example.com/v1/things';

/** A fetch stub that replays the given responses in order (the last one repeats). */
function fetchSequence(...responses: (() => Response)[]) {
  let call = 0;
  return vi.fn(async () => responses[Math.min(call++, responses.length - 1)]());
}

const respond = (status: number, body = '', headers: Record<string, string> = {}) => () => new Response(body, { status, headers });
const asFetch = (fn: unknown) => fn as typeof fetch;

async function captureError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
  throw new Error('expected the request to reject');
}

describe('request', () => {
  it('returns status, text and url on success without sleeping', async () => {
    const fetchImpl = fetchSequence(respond(200, 'hello'));
    const sleep = vi.fn(async (_ms: number) => {});
    const res = await request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep });
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');
    expect(res.url).toBe(URL_UNDER_TEST);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a 503 and then succeeds', async () => {
    const fetchImpl = fetchSequence(respond(503), respond(503), respond(200, 'ok'));
    const sleep = vi.fn(async (_ms: number) => {});
    const res = await request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep, retries: 3, backoffBaseMs: 100 });
    expect(res.text).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // Backoff with jitter: between half and all of base * 2^attempt.
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(50);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(100);
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(100);
    expect(sleep.mock.calls[1][0]).toBeLessThanOrEqual(200);
  });

  it('gives up after `retries` further attempts', async () => {
    const fetchImpl = fetchSequence(respond(503));
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep, retries: 2 }));
    expect(err.status).toBe(503);
    expect(err.rateLimited).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on a non-retryable 404', async () => {
    const fetchImpl = fetchSequence(respond(404));
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep, retries: 3 }));
    expect(err.status).toBe(404);
    expect(err.url).toBe(URL_UNDER_TEST);
    expect(err.message).toContain('api.example.com');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits for the Retry-After period on a 429', async () => {
    const fetchImpl = fetchSequence(respond(429, '', { 'retry-after': '2' }), respond(200, 'ok'));
    const sleep = vi.fn(async (_ms: number) => {});
    const res = await request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep });
    expect(res.status).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('marks a GitHub-style 403 with no remaining quota as rate limited', async () => {
    const fetchImpl = fetchSequence(respond(403, '', { 'x-ratelimit-remaining': '0' }));
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep: async () => {}, retries: 0 }));
    expect(err.status).toBe(403);
    expect(err.rateLimited).toBe(true);
  });

  it('does not treat an ordinary 403 as rate limited or retry it', async () => {
    const fetchImpl = fetchSequence(respond(403));
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep }));
    expect(err.rateLimited).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails fast without sleeping when Retry-After exceeds maxBackoffMs', async () => {
    const fetchImpl = fetchSequence(respond(429, '', { 'retry-after': '120' }), respond(200, 'ok'));
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep, retries: 3, maxBackoffMs: 5000 }));
    expect(err.status).toBe(429);
    expect(err.rateLimited).toBe(true);
    expect(err.retryAfterMs).toBe(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('turns an aborted request into an HttpError with a null status', async () => {
    const fetchImpl = vi.fn(async () => {
      const abort = new Error('This operation was aborted');
      abort.name = 'AbortError';
      throw abort;
    });
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep: async () => {}, retries: 0, timeoutMs: 250 }));
    expect(err.status).toBeNull();
    expect(err.message).toMatch(/Timed out after 250ms/);
  });

  it('retries network errors and reports the last one', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('socket hang up');
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await captureError(request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), sleep, retries: 1 }));
    expect(err.status).toBeNull();
    expect(err.message).toBe('Network error: socket hang up');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('caps the body at maxBytes', async () => {
    const fetchImpl = fetchSequence(respond(200, 'x'.repeat(5000)));
    const res = await request(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl), maxBytes: 1000 });
    expect(res.text).toHaveLength(1000);
  });
});

describe('getJson', () => {
  it('parses a JSON body', async () => {
    const fetchImpl = fetchSequence(respond(200, '{"items":[1,2,3]}'));
    const body = await getJson<{ items: number[] }>(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl) });
    expect(body.items).toEqual([1, 2, 3]);
  });

  it('throws HttpError on malformed JSON', async () => {
    const fetchImpl = fetchSequence(respond(200, '<html>Service unavailable</html>'));
    const err = await captureError(getJson(URL_UNDER_TEST, { fetchImpl: asFetch(fetchImpl) }));
    expect(err.status).toBe(200);
    expect(err.message).toMatch(/Malformed JSON/);
  });
});

describe('backoffDelay', () => {
  const noJitter = () => 1;

  it('doubles with each attempt', () => {
    expect(backoffDelay(0, 500, 20_000, noJitter)).toBe(500);
    expect(backoffDelay(1, 500, 20_000, noJitter)).toBe(1000);
    expect(backoffDelay(2, 500, 20_000, noJitter)).toBe(2000);
    expect(backoffDelay(3, 500, 20_000, noJitter)).toBe(4000);
  });

  it('is capped at the maximum', () => {
    expect(backoffDelay(10, 500, 20_000, noJitter)).toBe(20_000);
    expect(backoffDelay(30, 500, 20_000, noJitter)).toBe(20_000);
  });

  it('jitters between half and the full exponential delay', () => {
    expect(backoffDelay(2, 500, 20_000, () => 0)).toBe(1000);
    expect(backoffDelay(2, 500, 20_000, () => 0.5)).toBe(1500);
  });
});

describe('retryAfterMs', () => {
  const now = Date.parse('2026-03-01T12:00:00Z');

  it('parses a number of seconds', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '2' }), now)).toBe(2000);
    expect(retryAfterMs(new Headers({ 'retry-after': '0' }), now)).toBe(0);
  });

  it('parses an HTTP date relative to now', () => {
    const headers = new Headers({ 'retry-after': 'Sun, 01 Mar 2026 12:00:30 GMT' });
    expect(retryAfterMs(headers, now)).toBe(30_000);
  });

  it('never returns a negative wait for a date in the past', () => {
    const headers = new Headers({ 'retry-after': 'Sun, 01 Mar 2026 11:00:00 GMT' });
    expect(retryAfterMs(headers, now)).toBe(0);
  });

  it('uses x-ratelimit-reset when the quota is exhausted', () => {
    const reset = String(now / 1000 + 45);
    const headers = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset });
    // 45 s until reset plus a 500 ms safety margin.
    expect(retryAfterMs(headers, now)).toBe(45_500);
  });

  it('ignores x-ratelimit-reset while quota remains, and returns null with no hints', () => {
    const reset = String(now / 1000 + 45);
    expect(retryAfterMs(new Headers({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': reset }), now)).toBeNull();
    expect(retryAfterMs(new Headers(), now)).toBeNull();
  });
});
