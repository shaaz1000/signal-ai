import { createHash } from 'node:crypto';
import type { Kind } from '@/lib/types';

const TRACKING_PARAMS = /^(utm_|ref$|ref_|source$|fbclid$|gclid$|mc_|igshid$|si$|share$)/i;

const GITHUB_RESERVED = new Set([
  'orgs', 'features', 'topics', 'collections', 'trending', 'sponsors', 'marketplace', 'about',
  'pricing', 'enterprise', 'blog', 'explore', 'settings', 'apps', 'login', 'join', 'readme',
  'notifications', 'issues', 'pulls', 'search', 'security', 'customer-stories', 'events', 'site',
]);

/** Rejects anything that is not a plain public http(s) URL. */
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && !['80', '443'].includes(u.port)) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || !host.includes('.') && !host.includes(':')) return false;
  if (/\.(local|localhost|internal|lan|home|corp|test|invalid|onion)$/.test(host)) return false;
  return !isPrivateAddress(host);
}

export function isPrivateAddress(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(':')) {
    const h = host.toLowerCase();
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    // URL parsing rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1; decode that form too.
    const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return false;
}

/** Normalises a URL for display and storage: https, no tracking params, no fragment. */
export function cleanUrl(raw: string): string | null {
  if (!isSafePublicUrl(raw)) return null;
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  let out = u.toString();
  if (u.pathname !== '/' && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export interface Canonical {
  /** Stable identity of the thing being described, e.g. `github:owner/repo`. */
  key: string;
  url: string;
  kind: Kind | null;
  repo?: { owner: string; name: string };
  arxivId?: string;
  hfId?: string;
}

/**
 * Maps any URL to the canonical identity of the project it points at, so a
 * Hacker News thread, a blog post link and a GitHub search hit for the same
 * repository all collapse into one discovery.
 */
export function canonicalize(raw: string): Canonical | null {
  const url = cleanUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'github.com' && parts.length >= 2 && !GITHUB_RESERVED.has(parts[0].toLowerCase())) {
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/, '');
    if (/^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(name)) {
      return {
        key: `github:${owner.toLowerCase()}/${name.toLowerCase()}`,
        url: `https://github.com/${owner}/${name}`,
        kind: 'repository',
        repo: { owner, name },
      };
    }
  }

  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const m = u.pathname.match(/\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/);
    if (m) return { key: `arxiv:${m[1]}`, url: `https://arxiv.org/abs/${m[1]}`, kind: 'paper', arxivId: m[1] };
  }

  if (host === 'huggingface.co') {
    if (parts[0] === 'papers' && /^\d{4}\.\d{4,5}$/.test(parts[1] ?? '')) {
      return { key: `arxiv:${parts[1]}`, url: `https://arxiv.org/abs/${parts[1]}`, kind: 'paper', arxivId: parts[1] };
    }
    if (parts[0] === 'spaces' && parts.length >= 3) {
      const id = `${parts[1]}/${parts[2]}`;
      return { key: `hf-space:${id.toLowerCase()}`, url: `https://huggingface.co/spaces/${id}`, kind: 'demo', hfId: id };
    }
    const reserved = ['datasets', 'docs', 'blog', 'models', 'spaces', 'papers', 'learn', 'tasks', 'pricing', 'organizations', 'collections', 'posts', 'join', 'login'];
    if (parts.length >= 2 && !reserved.includes(parts[0])) {
      const id = `${parts[0]}/${parts[1]}`;
      return { key: `hf-model:${id.toLowerCase()}`, url: `https://huggingface.co/${id}`, kind: 'model', hfId: id };
    }
  }

  const path = u.pathname.replace(/\/$/, '');
  return { key: `url:${host}${path}${u.search}`.toLowerCase(), url, kind: null };
}

/** Short stable id, safe as a URL path segment and as a bare `#fragment`. */
export function stableId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
