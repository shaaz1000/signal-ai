import { describe, expect, it } from 'vitest';
import { canonicalize, cleanUrl, isSafePublicUrl, stableId } from '@/lib/utils/url';

describe('isSafePublicUrl', () => {
  it.each([
    ['javascript: scheme', 'javascript:alert(1)'],
    ['file: scheme', 'file:///etc/passwd'],
    ['embedded credentials', 'https://admin:hunter2@example.com/'],
    ['username only', 'https://admin@example.com/'],
    ['localhost', 'http://localhost/admin'],
    ['loopback IPv4', 'http://127.0.0.1/'],
    ['10.x private range', 'http://10.0.0.5/metrics'],
    ['192.168.x private range', 'http://192.168.1.1/'],
    ['172.16.x private range', 'http://172.16.4.2/'],
    ['cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['non-standard port', 'https://example.com:8443/'],
    ['.internal hostname', 'https://billing.internal/'],
    ['.local hostname', 'http://printer.local/'],
    ['single-label hostname', 'http://intranet/'],
    ['not a URL', 'not a url'],
    ['empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(isSafePublicUrl(url)).toBe(false);
  });

  it('rejects an IPv4-mapped IPv6 loopback address', () => {
    expect(isSafePublicUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
  });

  it.each([
    'https://example.com/blog/post',
    'http://example.com/',
    'https://example.com:443/path',
    'https://github.com/vercel/next.js',
    'https://8.8.8.8/',
  ])('accepts %s', (url) => {
    expect(isSafePublicUrl(url)).toBe(true);
  });
});

describe('canonicalize', () => {
  it('maps every URL shape of one GitHub repository to the same key', () => {
    const variants = [
      'https://github.com/Owner/Repo',
      'https://github.com/Owner/Repo/tree/main',
      'https://github.com/Owner/Repo.git',
      'https://github.com/Owner/Repo/issues/3',
      'https://www.github.com/owner/repo/',
      'https://github.com/Owner/Repo?utm_source=hn#readme',
    ];
    for (const v of variants) {
      const c = canonicalize(v);
      expect(c?.key, v).toBe('github:owner/repo');
      expect(c?.kind, v).toBe('repository');
    }
    const c = canonicalize('https://github.com/Owner/Repo/tree/main');
    expect(c?.url).toBe('https://github.com/Owner/Repo');
    expect(c?.repo).toEqual({ owner: 'Owner', name: 'Repo' });
  });

  it.each([
    'https://github.com/topics/webassembly',
    'https://github.com/orgs/vercel',
    'https://github.com/trending/rust',
  ])('does not treat %s as a repository', (url) => {
    const c = canonicalize(url);
    expect(c).not.toBeNull();
    expect(c?.kind).toBeNull();
    expect(c?.repo).toBeUndefined();
    expect(c?.key.startsWith('url:github.com/')).toBe(true);
  });

  it('does not treat a bare GitHub profile as a repository', () => {
    expect(canonicalize('https://github.com/torvalds')?.kind).toBeNull();
  });

  it('maps arXiv abs/pdf links and Hugging Face paper pages to one arxiv key', () => {
    const variants = [
      'https://arxiv.org/abs/2501.01234',
      'https://arxiv.org/abs/2501.01234v2',
      'https://arxiv.org/pdf/2501.01234v3',
      'http://export.arxiv.org/abs/2501.01234v1',
      'https://huggingface.co/papers/2501.01234',
    ];
    for (const v of variants) {
      const c = canonicalize(v);
      expect(c?.key, v).toBe('arxiv:2501.01234');
      expect(c?.kind, v).toBe('paper');
      expect(c?.url, v).toBe('https://arxiv.org/abs/2501.01234');
      expect(c?.arxivId, v).toBe('2501.01234');
    }
  });

  it('recognises Hugging Face models and spaces', () => {
    const model = canonicalize('https://huggingface.co/Meta-Llama/Llama-3-8B/tree/main');
    expect(model).toMatchObject({ key: 'hf-model:meta-llama/llama-3-8b', kind: 'model', hfId: 'Meta-Llama/Llama-3-8B', url: 'https://huggingface.co/Meta-Llama/Llama-3-8B' });

    const space = canonicalize('https://huggingface.co/spaces/Acme/Demo');
    expect(space).toMatchObject({ key: 'hf-space:acme/demo', kind: 'demo', hfId: 'Acme/Demo', url: 'https://huggingface.co/spaces/Acme/Demo' });
  });

  it('does not treat Hugging Face blog or docs pages as models', () => {
    expect(canonicalize('https://huggingface.co/blog/some-post')?.kind).toBeNull();
    expect(canonicalize('https://huggingface.co/docs/transformers')?.kind).toBeNull();
  });

  it('strips tracking parameters and fragments from generic URLs', () => {
    const c = canonicalize('https://Example.com/posts/launch?utm_source=newsletter&utm_campaign=x&id=7&fbclid=abc#comments');
    expect(c?.kind).toBeNull();
    expect(c?.url).toBe('https://example.com/posts/launch?id=7');
    expect(c?.key).toBe('url:example.com/posts/launch?id=7');
  });

  it('gives tracked and untracked copies of an article the same key', () => {
    const a = canonicalize('https://www.example.com/posts/launch/?utm_medium=social');
    const b = canonicalize('https://example.com/posts/launch#top');
    expect(a?.key).toBe(b?.key);
  });

  it('returns null for unsafe URLs', () => {
    expect(canonicalize('http://127.0.0.1/owner/repo')).toBeNull();
    expect(canonicalize('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('http://localhost:3000/')).toBeNull();
  });
});

describe('stableId', () => {
  it('is a deterministic 12-character hex string', () => {
    const id = stableId('github:owner/repo');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(stableId('github:owner/repo')).toBe(id);
  });

  it('differs for different keys', () => {
    expect(stableId('github:owner/repo')).not.toBe(stableId('github:owner/repo2'));
  });
});
