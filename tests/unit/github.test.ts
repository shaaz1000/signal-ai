import { describe, expect, it, vi } from 'vitest';
import { buildQueries, githubSource, repoToCandidate } from '@/lib/ingestion/sources/github';
import { CandidateSchema, type SourceContext } from '@/lib/ingestion/types';
import { createLogger } from '@/lib/utils/log';

type GhRepo = Parameters<typeof repoToCandidate>[0];

const now = new Date('2026-03-01T12:00:00Z');

const ghRepo = (overrides: Partial<GhRepo> = {}): GhRepo => ({
  id: 900100,
  full_name: 'acme/vexdb',
  name: 'vexdb',
  owner: { login: 'acme' },
  html_url: 'https://github.com/acme/vexdb',
  description: 'A small vector database for embedding search',
  fork: false,
  archived: false,
  created_at: '2026-02-20T10:00:00Z',
  pushed_at: '2026-02-28T18:00:00Z',
  homepage: 'https://vexdb.example.com',
  stargazers_count: 1240,
  forks_count: 61,
  open_issues_count: 14,
  language: 'Rust',
  license: { spdx_id: 'MIT' },
  topics: ['vector-database', 'rust'],
  ...overrides,
});

describe('buildQueries', () => {
  it('is deterministic for a fixed date', () => {
    expect(buildQueries(now, true)).toEqual(buildQueries(new Date(now.getTime()), true));
    expect(buildQueries(now, false)).toEqual(buildQueries(new Date(now.getTime()), false));
  });

  it('derives date bounds from the supplied date', () => {
    const [rising, breakouts] = buildQueries(now, false);
    expect(rising.q).toBe('created:>2026-02-22 stars:>75');
    expect(breakouts.q).toBe('created:>2026-01-30 stars:>400');
  });

  it('uses fewer queries when unauthenticated', () => {
    const anonymous = buildQueries(now, false);
    const authenticated = buildQueries(now, true);
    expect(anonymous).toHaveLength(4);
    expect(authenticated).toHaveLength(14);
    expect(anonymous.some((q) => q.why.startsWith('gems:'))).toBe(false);
    expect(authenticated.some((q) => q.why.startsWith('gems:'))).toBe(true);
  });

  it('never searches by lifetime stars without a created: or pushed: bound', () => {
    // Sweep a week of three-hour slots so every topic rotation is covered.
    for (let slot = 0; slot < 56; slot++) {
      const at = new Date(now.getTime() + slot * 3 * 3_600_000);
      for (const authenticated of [true, false]) {
        for (const query of buildQueries(at, authenticated)) {
          expect(query.q, query.q).toMatch(/\b(created|pushed):>\d{4}-\d{2}-\d{2}/);
        }
      }
    }
  });

  it('rotates topics between runs', () => {
    const topicsAt = (d: Date) => buildQueries(d, false).filter((q) => q.why.startsWith('topic:')).map((q) => q.why);
    expect(topicsAt(now)).not.toEqual(topicsAt(new Date(now.getTime() + 3 * 3_600_000)));
  });
});

describe('repoToCandidate', () => {
  it('maps a repository onto a valid primary candidate', () => {
    const c = repoToCandidate(ghRepo(), now);
    expect(c).toMatchObject({
      sourceId: 'github',
      externalId: '900100',
      url: 'https://github.com/acme/vexdb',
      title: 'acme/vexdb',
      author: 'acme',
      points: 1240,
      primary: true,
      preFiltered: true,
      tags: ['vector-database', 'rust'],
    });
    expect(c?.publishedAt?.toISOString()).toBe('2026-02-20T10:00:00.000Z');
    expect(c?.repo).toMatchObject({ owner: 'acme', name: 'vexdb', stars: 1240, forks: 61, openIssues: 14, language: 'Rust', license: 'MIT' });
    expect(CandidateSchema.safeParse(c).success).toBe(true);
  });

  it('skips forks and archived repositories', () => {
    expect(repoToCandidate(ghRepo({ fork: true }), now)).toBeNull();
    expect(repoToCandidate(ghRepo({ archived: true }), now)).toBeNull();
  });

  it('tolerates missing optional fields', () => {
    const sparse = ghRepo({ description: null, pushed_at: null, homepage: null, language: null, license: null });
    delete sparse.topics;
    const c = repoToCandidate(sparse, now);
    expect(c).not.toBeNull();
    expect(c?.description).toBe('');
    expect(c?.tags).toEqual([]);
    expect(c?.repo).toMatchObject({ description: null, pushedAt: null, homepage: null, language: null, license: null, watchers: null, topics: [] });
    expect(CandidateSchema.safeParse(c).success).toBe(true);
  });

  it('treats a NOASSERTION licence as no licence', () => {
    expect(repoToCandidate(ghRepo({ license: { spdx_id: 'NOASSERTION' } }), now)?.repo?.license).toBeNull();
  });

  it('returns null for records without an owner or a star count', () => {
    expect(repoToCandidate(ghRepo({ owner: null }), now)).toBeNull();
    expect(repoToCandidate({ ...ghRepo(), stargazers_count: undefined } as unknown as GhRepo, now)).toBeNull();
  });
});

describe('githubSource.fetch', () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  function context(fetchImpl: (url: string) => Promise<Response>, env: Record<string, string | undefined> = {}) {
    const lines: string[] = [];
    const sleep = vi.fn(async () => {});
    const spy = vi.fn(fetchImpl);
    const ctx: SourceContext = {
      now,
      env,
      log: createLogger({}, (line) => lines.push(line)),
      http: { fetchImpl: spy as unknown as typeof fetch, sleep, retries: 0 },
    };
    return { ctx, spy, sleep, warnings: () => lines.filter((l) => l.includes('github query failed')) };
  }

  it('returns candidates on success and only calls the search API', async () => {
    let id = 0;
    const { ctx, spy, sleep, warnings } = context(async () => {
      id++;
      return json({ items: [ghRepo({ id, full_name: `acme/project-${id}`, name: `project-${id}`, html_url: `https://github.com/acme/project-${id}` })] });
    });
    const out = await githubSource.fetch(ctx);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(out.map((c) => c.title)).toEqual(['acme/project-1', 'acme/project-2', 'acme/project-3', 'acme/project-4']);
    for (const call of spy.mock.calls) expect(call[0]).toMatch(/^https:\/\/api\.github\.com\/search\/repositories\?q=/);
    // Paces itself between queries, but not before the first.
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(warnings()).toHaveLength(0);
  });

  it('sends the token and runs the larger query set when authenticated', async () => {
    const seen: (string | null)[] = [];
    const lines: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return json({ items: [] });
    });
    const out = await githubSource.fetch({
      now,
      env: { GITHUB_TOKEN: 'test-token-value' },
      log: createLogger({}, (line) => lines.push(line)),
      http: { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, retries: 0 },
    });
    expect(out).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(14);
    expect(new Set(seen)).toEqual(new Set(['Bearer test-token-value']));
  });

  it('deduplicates a repository returned by more than one query', async () => {
    const { ctx, spy } = context(async () => json({ items: [ghRepo(), ghRepo({ id: 900200, full_name: 'acme/other', name: 'other', html_url: 'https://github.com/acme/other' })] }));
    const out = await githubSource.fetch(ctx);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(out.map((c) => c.externalId).sort()).toEqual(['900100', '900200']);
  });

  it('leaves forks and archived repositories out of the results', async () => {
    const { ctx } = context(async () => json({ items: [ghRepo(), ghRepo({ id: 2, fork: true }), ghRepo({ id: 3, archived: true })] }));
    const out = await githubSource.fetch(ctx);
    expect(out.map((c) => c.externalId)).toEqual(['900100']);
  });

  it('keeps partial results and stops early when a query is rate limited', async () => {
    let call = 0;
    const { ctx, spy, warnings } = context(async () => {
      call++;
      if (call === 1) return json({ items: [ghRepo()] });
      return json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1772370000' });
    });
    const out = await githubSource.fetch(ctx);
    expect(out.map((c) => c.externalId)).toEqual(['900100']);
    // Query 2 hit the limit; queries 3 and 4 were never sent.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(warnings()).toHaveLength(1);
  });

  it('carries on past an ordinary failed query', async () => {
    let call = 0;
    const { ctx, spy, warnings } = context(async () => {
      call++;
      return call === 2 ? json({ message: 'Server error' }, 500) : json({ items: [ghRepo({ id: call })] });
    });
    const out = await githubSource.fetch(ctx);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(out).toHaveLength(3);
    expect(warnings()).toHaveLength(1);
  });

  it('throws when every query fails', async () => {
    const { ctx, spy } = context(async () => json({ message: 'Server error' }, 500));
    await expect(githubSource.fetch(ctx)).rejects.toThrow('All 4 GitHub search queries failed');
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('throws when the very first query is rate limited', async () => {
    const { ctx, spy } = context(async () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0' }));
    await expect(githubSource.fetch(ctx)).rejects.toThrow('All 1 GitHub search queries failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('counts a body without an items array as a failed query', async () => {
    let call = 0;
    const partial = context(async () => {
      call++;
      return call === 1 ? json({ message: 'Validation Failed' }) : json({ items: [ghRepo()] });
    });
    const out = await githubSource.fetch(partial.ctx);
    expect(out).toHaveLength(1);
    expect(partial.warnings()).toHaveLength(1);
    expect(partial.warnings()[0]).toContain('no items array');

    const allMalformed = context(async () => json({ total_count: 0 }));
    await expect(githubSource.fetch(allMalformed.ctx)).rejects.toThrow('All 4 GitHub search queries failed');
  });

  it('counts a non-JSON body as a failed query', async () => {
    const { ctx } = context(async () => new Response('<html>Bad gateway</html>', { status: 200 }));
    await expect(githubSource.fetch(ctx)).rejects.toThrow('All 4 GitHub search queries failed');
  });
});
