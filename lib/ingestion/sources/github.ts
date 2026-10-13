import { getJson, HttpError, request, type HttpOptions } from '@/lib/utils/http';
import { isoDay, DAY, parseDate } from '@/lib/utils/time';
import type { CandidateInput, RepoFacts, SourceAdapter, SourceContext } from '../types';

const API = 'https://api.github.com';

/** Topics are rotated across runs so each run stays inside the search rate limit. */
export const TOPICS = [
  'ai', 'llm', 'machine-learning', 'generative-ai', 'computer-vision', 'robotics', 'ai-agents', 'agentic-ai',
  'langgraph', 'mcp', 'rag', 'browser-automation', 'reverse-engineering', 'developer-tools', 'webassembly',
  'emulator', 'webgpu', 'self-hosted', 'text-to-speech', 'diffusion', 'local-llm', 'game-engine',
  'creative-coding', 'computer-use',
];

interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string } | null;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  created_at: string;
  pushed_at: string | null;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  subscribers_count?: number;
  language: string | null;
  license: { spdx_id: string | null } | null;
  topics?: string[];
}

export function githubHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) h.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

export function toRepoFacts(r: GhRepo, now: Date): RepoFacts | null {
  if (!r || typeof r.full_name !== 'string' || !r.owner?.login || typeof r.stargazers_count !== 'number') return null;
  const license = r.license?.spdx_id;
  return {
    owner: r.owner.login,
    name: r.name,
    description: r.description ?? null,
    stars: r.stargazers_count,
    forks: r.forks_count ?? 0,
    openIssues: r.open_issues_count ?? 0,
    watchers: typeof r.subscribers_count === 'number' ? r.subscribers_count : null,
    language: r.language ?? null,
    license: license && license !== 'NOASSERTION' ? license : null,
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 20) : [],
    createdAt: parseDate(r.created_at, now),
    pushedAt: parseDate(r.pushed_at, now),
    homepage: r.homepage || null,
    isFork: Boolean(r.fork),
    archived: Boolean(r.archived),
  };
}

export function repoToCandidate(r: GhRepo, now: Date): CandidateInput | null {
  const facts = toRepoFacts(r, now);
  if (!facts || facts.isFork || facts.archived) return null;
  return {
    sourceId: 'github',
    externalId: String(r.id),
    url: r.html_url,
    title: r.full_name,
    description: facts.description ?? '',
    author: facts.owner,
    publishedAt: facts.createdAt,
    kindHint: 'repository',
    claimType: 'project_release',
    tags: facts.topics,
    points: facts.stars,
    repo: facts,
    primary: true,
    preFiltered: true,
  };
}

/** Builds this run's search queries. Exported so tests can pin the rotation. */
export function buildQueries(now: Date, authenticated: boolean): { q: string; sort: 'stars' | 'updated'; why: string }[] {
  const d = (days: number) => isoDay(new Date(now.getTime() - days * DAY));
  const queries: { q: string; sort: 'stars' | 'updated'; why: string }[] = [
    // Brand-new repositories that picked up stars quickly, whatever the topic.
    { q: `created:>${d(7)} stars:>75`, sort: 'stars', why: 'new-and-rising' },
    { q: `created:>${d(30)} stars:>400`, sort: 'stars', why: 'month-breakouts' },
  ];
  const perRun = authenticated ? 6 : 2;
  const slot = Math.floor(now.getTime() / (3 * 3_600_000));
  for (let i = 0; i < perRun; i++) {
    const topic = TOPICS[(slot * perRun + i) % TOPICS.length];
    queries.push({ q: `topic:${topic} created:>${d(45)} stars:>40`, sort: 'stars', why: `topic:${topic}` });
    // Small, recently active projects: the hidden-gem pool.
    if (authenticated) queries.push({ q: `topic:${topic} pushed:>${d(3)} created:>${d(120)} stars:15..600`, sort: 'updated', why: `gems:${topic}` });
  }
  return queries;
}

export const githubSource: SourceAdapter = {
  meta: {
    id: 'github',
    name: 'GitHub',
    group: 'github',
    // GitHub hosts the code; it does not vouch for what a README claims.
    reliability: 0.5,
    owner: 'github',
    homepage: 'https://github.com',
  },
  async fetch(ctx: SourceContext): Promise<CandidateInput[]> {
    const authenticated = Boolean(ctx.env.GITHUB_TOKEN);
    const queries = buildQueries(ctx.now, authenticated);
    // Search allows 30 requests/min with a token and 10 without. Stay under it.
    const gapMs = authenticated ? 2200 : 6500;
    const sleep = ctx.http.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const seen = new Map<string, CandidateInput>();
    let failures = 0;

    for (const [i, query] of queries.entries()) {
      if (i > 0) await sleep(gapMs);
      const url = `${API}/search/repositories?q=${encodeURIComponent(query.q)}&sort=${query.sort}&order=desc&per_page=40`;
      try {
        const body = await getJson<{ items?: GhRepo[] }>(url, { ...ctx.http, headers: githubHeaders(ctx.env) });
        if (!Array.isArray(body.items)) throw new HttpError('GitHub search returned no items array', url, 200);
        for (const item of body.items) {
          const c = repoToCandidate(item, ctx.now);
          if (c) seen.set(c.externalId, c);
        }
      } catch (err) {
        failures++;
        ctx.log.warn('github query failed', { query: query.why, error: (err as Error).message });
        // A rate limit will not clear within this run; keep what we have.
        if (err instanceof HttpError && err.rateLimited) break;
      }
    }
    if (seen.size === 0 && failures > 0) throw new Error(`All ${failures} GitHub search queries failed`);
    return [...seen.values()];
  },
};

export interface RepoEnrichment {
  facts: RepoFacts;
  readme: string | null;
  contributors: number | null;
  latestRelease: { tag: string; publishedAt: Date | null } | null;
}

/** Authoritative repository lookup used by verification. Returns null on 404. */
export async function fetchRepo(
  owner: string,
  name: string,
  env: Record<string, string | undefined>,
  http: HttpOptions,
  now: Date,
  depth: 'metrics' | 'full',
): Promise<RepoEnrichment | null> {
  const headers = githubHeaders(env);
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  let raw: GhRepo;
  try {
    raw = await getJson<GhRepo>(base, { ...http, headers });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 451)) return null;
    throw err;
  }
  const facts = toRepoFacts(raw, now);
  if (!facts) return null;
  const out: RepoEnrichment = { facts, readme: null, contributors: null, latestRelease: null };
  if (depth === 'metrics') return out;

  const optional = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError && err.rateLimited) throw err;
      return null;
    }
  };

  out.readme = await optional(async () => {
    const res = await request(`${base}/readme`, { ...http, retries: 1, maxBytes: 200_000, headers: { ...headers, accept: 'application/vnd.github.raw' } });
    return res.text;
  });
  out.latestRelease = await optional(async () => {
    const rel = await getJson<{ tag_name?: string; published_at?: string }>(`${base}/releases/latest`, { ...http, retries: 0, headers });
    return rel.tag_name ? { tag: String(rel.tag_name).slice(0, 60), publishedAt: parseDate(rel.published_at, now) } : null;
  });
  out.contributors = await optional(async () => {
    const res = await request(`${base}/contributors?per_page=1&anon=1`, { ...http, retries: 0, headers });
    const last = res.headers.get('link')?.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (last) return Number(last[1]);
    const arr = JSON.parse(res.text || '[]');
    return Array.isArray(arr) ? arr.length : null;
  });
  return out;
}
