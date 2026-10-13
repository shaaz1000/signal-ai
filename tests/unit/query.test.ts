import { describe, expect, it } from 'vitest';
import {
  buildToday, DEFAULT_QUERY, diversify, PAGE_SIZE, parseQuery, queryFeed, toSearchParams,
  type FeedPrefs, type FeedQuery, type TodaySections,
} from '@/lib/feed/query';
import type { DiscoveryView, RepoView, Scores, SourceGroup, SourceRefView } from '@/lib/types';

const NOW = '2026-03-01T12:00:00.000Z';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hoursAgo = (h: number) => new Date(new Date(NOW).getTime() - h * HOUR).toISOString();
const daysAgo = (d: number) => new Date(new Date(NOW).getTime() - d * DAY).toISOString();

const NO_PREFS: FeedPrefs = { hiddenCategories: [], hiddenGroups: [] };

const source = (sourceId: string, group: SourceGroup, primary = false): SourceRefView => ({
  sourceId, sourceName: sourceId, group, primary, url: `https://${sourceId}.example.com/ref`, title: 'Reference', publishedAt: null, points: null, comments: null,
});

const repoView = (overrides: Partial<RepoView> = {}): RepoView => ({
  owner: 'acme', name: 'project', language: 'Rust', license: 'MIT', stars: 900, forks: 40, openIssues: 12, contributors: 5,
  createdAt: daysAgo(20), pushedAt: daysAgo(2), topics: [], latestRelease: null,
  growth: { observedDelta: null, observedHours: null, starsPerDayObserved: null, starsPerDayLifetime: null, snapshots: 0 },
  anomaly: false,
  ...overrides,
});

const SCORES: Scores = { total: 50, novelty: 50, momentum: 50, significance: 50, credibility: 70, usefulness: 50, freshness: 50, gem: 0 };

let seq = 0;
type ViewOverrides = Partial<Omit<DiscoveryView, 'scores'>> & { scores?: Partial<Scores> };

/** A verified, medium-confidence article from a unique site; tests override what they care about. */
function view(overrides: ViewOverrides = {}): DiscoveryView {
  const id = overrides.id ?? `item-${String(++seq).padStart(4, '0')}`;
  const { scores, ...rest } = overrides;
  return {
    id,
    kind: 'article',
    title: `Entry ${id}`,
    headline: `Entry ${id}`,
    summary: 'A neutral one-line summary.',
    category: 'ai-tools',
    tags: [],
    claimType: 'third_party',
    executionMode: null,
    canonicalUrl: `https://${id}.example.org/post`,
    author: null,
    authorVerified: false,
    publishedAt: hoursAgo(6),
    firstDiscoveredAt: hoursAgo(5),
    lastVerifiedAt: hoursAgo(4),
    lastActivityAt: null,
    status: 'verified',
    confidence: 70,
    confidenceLevel: 'medium',
    scores: { ...SCORES, ...scores },
    reasons: [],
    credibilityFactors: [],
    evidence: [],
    sources: [source('arstechnica', 'news')],
    editorial: {
      what: 'A description long enough to be featured, because featured items need more than sixty characters here.',
      why: 'Why it matters.', how: null, whoCares: 'Readers.', limitations: [], applications: null, method: 'extractive', model: null,
    },
    repo: null,
    industries: [],
    evidenceStage: null,
    conceptId: null,
    model: null,
    flags: [],
    fixture: false,
    ...rest,
  };
}

const repoItem = (owner: string, name: string, overrides: ViewOverrides = {}, repo: Partial<RepoView> = {}): DiscoveryView =>
  view({
    kind: 'repository', category: 'dev-tools', claimType: 'project_release', canonicalUrl: `https://github.com/${owner}/${name}`,
    sources: [source('github', 'github', true)], repo: repoView({ owner, name, ...repo }),
    ...overrides,
  });

const unverified = (overrides: ViewOverrides = {}): DiscoveryView =>
  view({ status: 'unverified', confidence: 25, confidenceLevel: 'unverified', ...overrides });

const query = (overrides: Partial<FeedQuery> = {}): FeedQuery => ({ ...DEFAULT_QUERY, sort: 'latest', ...overrides });
const ids = (items: DiscoveryView[]) => items.map((d) => d.id);
const run = (all: DiscoveryView[], q: Partial<FeedQuery> = {}, prefs = NO_PREFS, opts = {}) => queryFeed(all, query(q), NOW, prefs, opts);

describe('parseQuery', () => {
  it('returns the defaults for empty parameters', () => {
    expect(parseQuery({})).toEqual(DEFAULT_QUERY);
  });

  it('accepts known values', () => {
    expect(parseQuery({ q: ' rust agents ', category: 'agents', sort: 'gems', window: '7d', language: 'C++', age: 'month', activity: 'day', industry: 'healthcare', page: '3' })).toEqual({
      q: 'rust agents', category: 'agents', sort: 'gems', window: '7d', language: 'C++', age: 'month', activity: 'day', industry: 'healthcare', page: 3,
    });
  });

  it('ignores unknown sort, category, window, age and activity values', () => {
    const parsed = parseQuery({ sort: 'most-hyped', category: 'crypto', window: '1y', age: 'ancient', activity: 'never' });
    expect(parsed).toEqual(DEFAULT_QUERY);
  });

  it('falls back to scope defaults rather than global defaults', () => {
    expect(parseQuery({ sort: 'bogus' }, { sort: 'momentum' }).sort).toBe('momentum');
    expect(parseQuery({ sort: 'latest' }, { sort: 'momentum' }).sort).toBe('latest');
  });

  it.each([
    ['999', 50],
    ['50', 50],
    ['2', 2],
    ['0', 1],
    ['-4', 1],
    ['abc', 1],
    ['', 1],
  ])('clamps page %j to %d', (page, expected) => {
    expect(parseQuery({ page }).page).toBe(expected);
  });

  it('uses the first value of a repeated parameter', () => {
    expect(parseQuery({ sort: ['latest', 'gems'], q: ['first', 'second'] })).toMatchObject({ sort: 'latest', q: 'first' });
  });

  it('bounds the search text and strips unexpected characters from the language', () => {
    expect(parseQuery({ q: 'x'.repeat(500) }).q).toHaveLength(120);
    expect(parseQuery({ language: 'Rust<script>' }).language).toBe('Rustscript');
  });
});

describe('toSearchParams', () => {
  it('omits everything for the default query', () => {
    expect(toSearchParams(DEFAULT_QUERY)).toBe('');
  });

  it('omits values equal to the defaults', () => {
    expect(toSearchParams({ ...DEFAULT_QUERY, sort: 'latest', page: 2 })).toBe('sort=latest&page=2');
    expect(toSearchParams({ ...DEFAULT_QUERY, sort: 'momentum' }, { sort: 'momentum' })).toBe('');
  });

  it('round-trips through parseQuery', () => {
    const original: FeedQuery = { q: 'rust agents', category: 'agents', sort: 'latest', window: '7d', language: 'C#', age: 'month', activity: 'week', industry: '', page: 3 };
    const params = Object.fromEntries(new URLSearchParams(toSearchParams(original)));
    expect(parseQuery(params)).toEqual(original);
  });

  it('round-trips against scope defaults', () => {
    const defaults = { sort: 'momentum' as const };
    const original: FeedQuery = { ...DEFAULT_QUERY, sort: 'trending', window: '24h' };
    const serialised = toSearchParams(original, defaults);
    expect(serialised).toBe('sort=trending&window=24h');
    expect(parseQuery(Object.fromEntries(new URLSearchParams(serialised)), defaults)).toEqual(original);
  });
});

describe('queryFeed: search', () => {
  const byTitle = view({ id: 'by-title', title: 'VexDB vector database', headline: 'VexDB: a small vector database' });
  const byTag = view({ id: 'by-tag', tags: ['webgpu', 'inference'] });
  const byRepo = repoItem('acme', 'gbemu', { id: 'by-repo' }, { language: 'Zig', topics: ['emulator'] });
  const all = [byTitle, byTag, byRepo];

  it.each([
    ['vexdb', ['by-title']],
    ['VECTOR', ['by-title']],
    ['webgpu', ['by-tag']],
    ['acme', ['by-repo']],
    ['acme/gbemu', ['by-repo']],
    ['gbemu', ['by-repo']],
    ['zig', ['by-repo']],
    ['emulator', ['by-repo']],
  ])('"%s" finds %j', (q, expected) => {
    expect(ids(run(all, { q }).items)).toEqual(expected);
  });

  it('requires every term to match', () => {
    expect(ids(run(all, { q: 'vector database' }).items)).toEqual(['by-title']);
    expect(run(all, { q: 'vector webgpu' }).items).toEqual([]);
    expect(run(all, { q: 'acme vexdb' }).items).toEqual([]);
  });

  it('ranks a title match above a match elsewhere', () => {
    const inSummary = view({ id: 'in-summary', summary: 'Mentions vexdb in passing.', scores: { total: 99 } });
    const result = run([inSummary, byTitle], { q: 'vexdb', sort: 'trending' });
    expect(ids(result.items)).toEqual(['by-title', 'in-summary']);
  });

  it('returns everything for an empty search', () => {
    expect(run(all, { q: '   ' }).total).toBe(3);
  });
});

describe('queryFeed: filters', () => {
  it('filters by category', () => {
    const all = [view({ id: 'agent', category: 'agents' }), view({ id: 'robot', category: 'robotics' })];
    expect(ids(run(all, { category: 'robotics' }).items)).toEqual(['robot']);
    expect(run(all, { category: 'all' }).total).toBe(2);
  });

  it('applies the time window to the publication date', () => {
    const oldButJustFound = view({ id: 'old-just-found', publishedAt: daysAgo(10), firstDiscoveredAt: hoursAgo(1) });
    const recent = view({ id: 'recent', publishedAt: hoursAgo(3), firstDiscoveredAt: hoursAgo(1) });
    const all = [oldButJustFound, recent];
    expect(ids(run(all, { window: '24h' }).items)).toEqual(['recent']);
    expect(ids(run(all, { window: '7d' }).items)).toEqual(['recent']);
    expect(ids(run(all, { window: '30d' }).items).sort()).toEqual(['old-just-found', 'recent']);
    expect(run(all, { window: 'all' }).total).toBe(2);
  });

  it('falls back to the discovery date when the publication date is unknown', () => {
    const undatedRecent = view({ id: 'undated-recent', publishedAt: null, firstDiscoveredAt: hoursAgo(2) });
    const undatedOld = view({ id: 'undated-old', publishedAt: null, firstDiscoveredAt: daysAgo(3) });
    expect(ids(run([undatedRecent, undatedOld], { window: '24h' }).items)).toEqual(['undated-recent']);
  });

  it('filters by language, case-insensitively, and lists the available languages', () => {
    const all = [repoItem('acme', 'a', { id: 'rust' }, { language: 'Rust' }), repoItem('beta', 'b', { id: 'python' }, { language: 'Python' }), view({ id: 'article' })];
    const result = run(all, { language: 'rust' });
    expect(ids(result.items)).toEqual(['rust']);
    expect(result.languages).toEqual(['Python', 'Rust']);
  });

  it('filters by repository age', () => {
    const all = [
      repoItem('acme', 'new', { id: 'three-days' }, { createdAt: daysAgo(3) }),
      repoItem('beta', 'mid', { id: 'three-weeks' }, { createdAt: daysAgo(21) }),
      repoItem('gamma', 'old', { id: 'three-years' }, { createdAt: daysAgo(1095) }),
      repoItem('delta', 'unknown', { id: 'undated' }, { createdAt: null }),
      view({ id: 'article' }),
    ];
    expect(ids(run(all, { age: 'week' }).items)).toEqual(['three-days']);
    expect(ids(run(all, { age: 'month' }).items).sort()).toEqual(['three-days', 'three-weeks']);
    expect(ids(run(all, { age: 'year' }).items).sort()).toEqual(['three-days', 'three-weeks']);
    expect(run(all, { age: 'any' }).total).toBe(5);
  });

  it('filters by recent push activity', () => {
    const all = [
      repoItem('acme', 'busy', { id: 'pushed-today' }, { pushedAt: hoursAgo(5) }),
      repoItem('beta', 'steady', { id: 'pushed-this-week' }, { pushedAt: daysAgo(4) }),
      repoItem('gamma', 'quiet', { id: 'pushed-last-year' }, { pushedAt: daysAgo(300) }),
      view({ id: 'article' }),
    ];
    expect(ids(run(all, { activity: 'day' }).items)).toEqual(['pushed-today']);
    expect(ids(run(all, { activity: 'week' }).items).sort()).toEqual(['pushed-this-week', 'pushed-today']);
  });

  it('applies a scope before the filters', () => {
    const all = [repoItem('acme', 'a', { id: 'repo' }), view({ id: 'article' })];
    const result = run(all, {}, NO_PREFS, { scope: (d: DiscoveryView) => d.kind === 'repository' });
    expect(ids(result.items)).toEqual(['repo']);
  });
});

describe('queryFeed: sorts', () => {
  it('orders latest by discovery time', () => {
    const all = [view({ id: 'older', firstDiscoveredAt: hoursAgo(9) }), view({ id: 'newest', firstDiscoveredAt: hoursAgo(1) }), view({ id: 'middle', firstDiscoveredAt: hoursAgo(4) })];
    expect(ids(run(all, { sort: 'latest' }).items)).toEqual(['newest', 'middle', 'older']);
  });

  it('excludes items with no gem score from the gems sort', () => {
    const all = [
      repoItem('acme', 'a', { id: 'small-gem', scores: { gem: 41, total: 40 } }),
      repoItem('beta', 'b', { id: 'big-gem', scores: { gem: 63, total: 45 } }),
      repoItem('gamma', 'c', { id: 'popular', scores: { gem: 0, total: 95 } }),
    ];
    expect(ids(run(all, { sort: 'gems' }).items)).toEqual(['big-gem', 'small-gem']);
  });

  it('requires high confidence and two independent sources for the verified sort', () => {
    const twoIndependent = [source('github', 'github', true), source('hackernews', 'community'), source('arstechnica', 'news')];
    const all = [
      view({ id: 'qualifies', confidence: 75, confidenceLevel: 'high', sources: twoIndependent }),
      view({ id: 'confidence-too-low', confidence: 74, sources: twoIndependent }),
      view({ id: 'one-independent', confidence: 90, confidenceLevel: 'high', sources: [source('github', 'github', true), source('hackernews', 'community')] }),
      view({ id: 'same-source-twice', confidence: 90, confidenceLevel: 'high', sources: [source('hackernews', 'community'), source('hackernews', 'community')] }),
      view({ id: 'primary-only', confidence: 90, confidenceLevel: 'high', sources: [source('github', 'github', true)] }),
    ];
    expect(ids(run(all, { sort: 'verified' }).items)).toEqual(['qualifies']);
  });

  it('limits the open-source sort to items with public code', () => {
    const withCode = view({ id: 'paper-with-code', kind: 'paper', evidence: [{ check: 'code_available', outcome: 'pass', detail: 'Source code is publicly available.', url: null }] });
    const all = [repoItem('acme', 'a', { id: 'repo' }), withCode, view({ id: 'article' })];
    expect(ids(run(all, { sort: 'open-source' }).items).sort()).toEqual(['paper-with-code', 'repo']);
  });
});

describe('queryFeed: quality gate and preferences', () => {
  it('excludes items below the gate unless includeUnverified is set', () => {
    const all = [view({ id: 'verified' }), view({ id: 'low-confidence', status: 'unverified', confidence: 45, confidenceLevel: 'low' }), unverified({ id: 'unverified' })];
    expect(ids(run(all).items).sort()).toEqual(['low-confidence', 'verified']);
    expect(ids(run(all, {}, NO_PREFS, { includeUnverified: true }).items).sort()).toEqual(['low-confidence', 'unverified', 'verified']);
  });

  it('respects hidden categories', () => {
    const all = [view({ id: 'agent', category: 'agents' }), view({ id: 'robot', category: 'robotics' })];
    const prefs: FeedPrefs = { hiddenCategories: ['robotics'], hiddenGroups: [] };
    expect(ids(run(all, {}, prefs).items)).toEqual(['agent']);
  });

  it('still shows a hidden category when it is requested explicitly', () => {
    const all = [view({ id: 'agent', category: 'agents' }), view({ id: 'robot', category: 'robotics' })];
    const prefs: FeedPrefs = { hiddenCategories: ['robotics'], hiddenGroups: [] };
    expect(ids(run(all, { category: 'robotics' }, prefs).items)).toEqual(['robot']);
  });

  it('respects hidden source groups, judged by the primary source', () => {
    const all = [
      view({ id: 'from-news', sources: [source('arstechnica', 'news')] }),
      view({ id: 'from-community', sources: [source('hackernews', 'community')] }),
      // A GitHub project that was also discussed on Hacker News is still a GitHub item.
      repoItem('acme', 'a', { id: 'repo-discussed', sources: [source('hackernews', 'community'), source('github', 'github', true)] }),
    ];
    const prefs: FeedPrefs = { hiddenCategories: [], hiddenGroups: ['community'] };
    expect(ids(run(all, {}, prefs).items).sort()).toEqual(['from-news', 'repo-discussed']);
  });
});

describe('queryFeed: paging', () => {
  const all = Array.from({ length: 60 }, (_, i) => view({ id: `page-${String(i).padStart(2, '0')}`, firstDiscoveredAt: hoursAgo(i + 1) }));

  it('returns N * PAGE_SIZE items for page N ("show more")', () => {
    const first = run(all, { page: 1 });
    const second = run(all, { page: 2 });
    const third = run(all, { page: 3 });
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(second.items).toHaveLength(2 * PAGE_SIZE);
    expect(third.items).toHaveLength(60);
    // Cumulative: each page starts with the previous one.
    expect(ids(second.items).slice(0, PAGE_SIZE)).toEqual(ids(first.items));
    expect(ids(third.items).slice(0, 2 * PAGE_SIZE)).toEqual(ids(second.items));
  });

  it('reports the total and page count, and tolerates a page past the end', () => {
    const result = run(all, { page: 40 });
    expect(result.total).toBe(60);
    expect(result.pageCount).toBe(3);
    expect(result.items).toHaveLength(60);
  });

  it('honours a custom page size', () => {
    const result = run(all, { page: 2 }, NO_PREFS, { pageSize: 10 });
    expect(result.items).toHaveLength(20);
    expect(result.pageCount).toBe(6);
  });

  it('reports one empty page when nothing matches', () => {
    expect(run(all, { q: 'no-such-term' })).toMatchObject({ items: [], total: 0, pageCount: 1 });
  });
});

describe('diversify', () => {
  const acme = [90, 89, 88, 87].map((total, i) => repoItem('acme', `tool-${i}`, { id: `acme-${i}`, scores: { total } }));
  const beta = repoItem('beta', 'engine', { id: 'beta-0', scores: { total: 86 } });
  const gamma = repoItem('gamma', 'kit', { id: 'gamma-0', scores: { total: 85 } });
  const byScore = [...acme, beta, gamma];
  const ownerOf = (d: DiscoveryView) => d.repo?.owner;

  it('stops one owner taking the first three slots when alternatives score nearly as high', () => {
    // By raw score the top three would all be acme.
    expect(byScore.slice(0, 3).map(ownerOf)).toEqual(['acme', 'acme', 'acme']);
    const out = diversify(byScore, (d) => d.scores.total);
    expect(out.slice(0, 3).map(ownerOf)).toEqual(['acme', 'beta', 'gamma']);
    expect(out[0].id).toBe('acme-0');
  });

  it('keeps every item exactly once', () => {
    const out = diversify(byScore, (d) => d.scores.total);
    expect(ids(out).sort()).toEqual(ids(byScore).sort());
  });

  it('does not promote a much weaker item just for variety', () => {
    const weak = repoItem('delta', 'toy', { id: 'delta-0', scores: { total: 20 } });
    const out = diversify([...acme.slice(0, 2), weak], (d) => d.scores.total);
    expect(ids(out)).toEqual(['acme-0', 'acme-1', 'delta-0']);
  });

  it('is applied to the trending feed', () => {
    const trending = queryFeed(byScore, { ...DEFAULT_QUERY, sort: 'trending' }, NOW, NO_PREFS);
    expect(trending.items.slice(0, 3).map(ownerOf)).toEqual(['acme', 'beta', 'gamma']);
  });
});

describe('buildToday', () => {
  const categories = ['ai-tools', 'agents', 'llms', 'dev-tools', 'research', 'robotics', 'creative', 'gaming-browser', 'launches', 'open-source'] as const;
  const gated: DiscoveryView[] = [];
  for (let i = 0; i < 40; i++) {
    const category = categories[i % categories.length];
    const scores = { total: 95 - i, momentum: 30 + ((i * 7) % 60), gem: i % 4 === 0 ? 20 + i : 0 };
    const base = { id: `today-${String(i).padStart(2, '0')}`, category, scores, firstDiscoveredAt: hoursAgo(i + 1) };
    if (i % 3 === 0) gated.push(repoItem(`owner-${i}`, `repo-${i}`, base));
    else if (i % 3 === 1) gated.push(view({ ...base, kind: category === 'research' ? 'paper' : 'article' }));
    else gated.push(view({ ...base, status: 'unverified', confidence: 45, confidenceLevel: 'low' }));
  }
  const held = Array.from({ length: 6 }, (_, i) => unverified({ id: `held-${i}`, scores: { total: 99 - i, gem: 80, momentum: 99 }, kind: 'repository', category: 'research' }));
  const all = [...gated, ...held];

  const sectionsOf = (t: TodaySections) => ({
    featured: t.featured ? [t.featured] : [], top: t.top, repos: t.repos, tools: t.tools, research: t.research,
    experiments: t.experiments, gems: t.gems, recent: t.recent, unverified: t.unverified,
  });
  const today = buildToday(all, NO_PREFS, null);
  const sections = sectionsOf(today);

  it('fills every section from a varied catalogue', () => {
    for (const [name, items] of Object.entries(sections)) expect(items.length, name).toBeGreaterThan(0);
    expect(today.top).toHaveLength(6);
  });

  it('never places one item in two sections', () => {
    const placed = Object.values(sections).flatMap(ids);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('puts unverified items only in the unverified section', () => {
    const heldIds = new Set(ids(held));
    for (const [name, items] of Object.entries(sections)) {
      if (name === 'unverified') continue;
      expect(items.filter((d) => heldIds.has(d.id)), name).toEqual([]);
    }
    expect(today.unverified).toHaveLength(4);
    expect(today.unverified.every((d) => heldIds.has(d.id))).toBe(true);
    // Highest-scoring held items first.
    expect(ids(today.unverified)).toEqual(['held-0', 'held-1', 'held-2', 'held-3']);
  });

  it('fills each section only with items that belong there', () => {
    expect(today.repos.every((d) => d.kind === 'repository')).toBe(true);
    expect(today.gems.every((d) => d.scores.gem > 0)).toBe(true);
    expect(today.research.every((d) => d.category === 'research' || d.kind === 'paper' || d.kind === 'model')).toBe(true);
    expect(today.experiments.every((d) => ['gaming-browser', 'creative', 'robotics'].includes(d.category))).toBe(true);
  });

  it('features a verified item, and honours a valid featuredId', () => {
    expect(today.featured?.status).toBe('verified');
    const chosen = buildToday(all, NO_PREFS, 'today-09');
    expect(chosen.featured?.id).toBe('today-09');
    expect(Object.values(sectionsOf(chosen)).flatMap(ids).filter((id) => id === 'today-09')).toHaveLength(1);
  });

  it('ignores a featuredId that is unverified or unknown', () => {
    expect(buildToday(all, NO_PREFS, 'held-0').featured?.id).toBe(today.featured?.id);
    expect(buildToday(all, NO_PREFS, 'no-such-id').featured?.id).toBe(today.featured?.id);
    // today-02 passes the gate at low confidence but is not verified.
    expect(buildToday(all, NO_PREFS, 'today-02').featured?.id).toBe(today.featured?.id);
  });

  it('respects hidden categories and source groups', () => {
    const prefs: FeedPrefs = { hiddenCategories: ['robotics'], hiddenGroups: ['github'] };
    const placed = Object.values(sectionsOf(buildToday(all, prefs, null))).flat();
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.some((d) => d.category === 'robotics')).toBe(false);
    expect(placed.some((d) => d.sources.some((s) => s.primary && s.group === 'github'))).toBe(false);
  });

  it('returns empty sections for an empty catalogue', () => {
    const empty = buildToday([], NO_PREFS, null);
    expect(empty.featured).toBeNull();
    expect(Object.values(sectionsOf(empty)).flat()).toEqual([]);
  });
});
