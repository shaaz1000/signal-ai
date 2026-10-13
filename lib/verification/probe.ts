import { lookup } from 'node:dns/promises';
import { HttpError, request, type HttpOptions } from '@/lib/utils/http';
import { isPrivateAddress, isSafePublicUrl } from '@/lib/utils/url';
import type { Probe } from './checks';

export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Rejects hosts that resolve to private or loopback addresses (DNS-based SSRF). */
export async function resolvesPublicly(url: string, resolve: HostResolver = defaultResolver): Promise<boolean> {
  if (!isSafePublicUrl(url)) return false;
  try {
    const addresses = await resolve(new URL(url).hostname);
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
  } catch {
    return false;
  }
}

/**
 * Checks that a URL exists. Redirects are followed by hand so every hop is
 * re-validated; a public page cannot bounce us to an internal address.
 */
export async function probeUrl(url: string, http: HttpOptions = {}, resolve?: HostResolver): Promise<Probe & { body?: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await resolvesPublicly(current, resolve))) return { state: 'error', via: 'URL is not a public address' };
    try {
      const res = await request(current, { ...http, redirect: 'manual', retries: 1, timeoutMs: 10_000, maxBytes: 80_000, headers: { accept: 'text/html,*/*;q=0.8', ...http.headers } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return { state: 'error', via: `HTTP ${res.status} without a Location header` };
        current = new URL(location, current).toString();
        continue;
      }
      return { state: 'ok', via: `HTTP ${res.status}`, body: res.text };
    } catch (err) {
      if (err instanceof HttpError && err.status !== null) {
        if (err.status === 404 || err.status === 410) return { state: 'not_found', via: `HTTP ${err.status}` };
        return { state: 'blocked', via: `HTTP ${err.status}` };
      }
      return { state: 'error', via: (err as Error).message };
    }
  }
  return { state: 'error', via: 'too many redirects' };
}
