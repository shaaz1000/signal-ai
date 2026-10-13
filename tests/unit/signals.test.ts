import { describe, expect, it } from 'vitest';
import type { RepoGrowth } from '@/lib/types';
import { independentRefs, scoreDiscovery, type CorpusStats, type ScoringInput, type ScoringRef } from '@/lib/scoring/signals';
import { DEFAULT_WEIGHTS, QUALITY_GATE, resolveWeights, WEIGHTS_VERSION, type Weights } from '@/lib/scoring/weights';

const now = new Date('2026-03-01T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR);
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

const corpus: CorpusStats = { total: 0, tagDocFreq: new Map() };

const ref = (overrides: Partial<ScoringRef> = {}): ScoringRef => ({
  group: 'github', owner: 'github', sourceName: 'GitHub', isPrimary: true, points: null, comments: null, ...overrides,
});
const news = (owner: string, sourceName: string): ScoringRef => ref({ group: 'news', owner, sourceName, isPrimary: false });
const hackerNews = (points: number, comments = 0): ScoringRef =>
  ref({ group: 'community', owner: 'hackernews', sourceName: 'Hacker News', isPrimary: false, points, comments });

type Repo = NonNullable<ScoringInput['repo']>;
const repo = (overrides: Partial<Repo> = {}): Repo => ({
  stars: 800,
  forks: 40,
  createdAt: daysAgo(20),
  pushedAt: hoursAgo(30),
  license: 'MIT',
  homepage: null,
  readmeLength: 2400,
  releaseAt: null,
  releaseTag: null,
  contributors: 4,
  ...overrides,
});

const growth = (overrides: Partial<RepoGrowth> = {}): RepoGrowth => ({
  observedDelta: null, observedHours: null, starsPerDayObserved: null, starsPerDayLifetime: null, snapshots: 1, ...overrides,
});

/** A plausible mid-ranking repository; each test overrides only what it is about. */
const input = (overrides: Partial<ScoringInput> = {}): ScoringInput => ({
  now,
  kind: 'repository',
  category: 'dev-tools',
  claimType: 'project_release',
  tags: ['rust', 'cli'],
  text: 'A command line tool for querying structured logs.',
  publishedAt: daysAgo(20),
  firstDiscoveredAt: daysAgo(3),
  lastActivityAt: hoursAgo(30),
  confidence: 70,
  refs: [ref()],
  repo: repo(),
  growth: null,
  anomaly: false,
  hf: null,
  hasCode: true,
  ...overrides,
});

const article = (overrides: Partial<ScoringInput> = {}): ScoringInput =>
  input({
    kind: 'article', category: 'llms', claimType: 'third_party', repo: null, hasCode: false,
    publishedAt: hoursAgo(6), firstDiscoveredAt: hoursAgo(5), lastActivityAt: null,
    refs: [news('arstechnica', 'Ars Technica')],
    ...overrides,
  });

describe('scoreDiscovery: repositories', () => {
  const rising = input({
    publishedAt: daysAgo(3),
    firstDiscoveredAt: hoursAgo(20),
    lastActivityAt: hoursAgo(2),
    repo: repo({ stars: 2400, forks: 150, createdAt: daysAgo(3), pushedAt: hoursAgo(2) }),
    growth: growth({ observedDelta: 900, observedHours: 6, starsPerDayObserved: 3600, starsPerDayLifetime: 800, snapshots: 2 }),
  });
  const dormant = input({
    publishedAt: daysAgo(1500),
    firstDiscoveredAt: hoursAgo(20),
    lastActivityAt: daysAgo(190),
    repo: repo({ stars: 48_000, forks: 5200, createdAt: daysAgo(1500), pushedAt: daysAgo(190), contributors: 300, releaseAt: daysAgo(400), releaseTag: 'v3.2.0' }),
    growth: growth({ starsPerDayLifetime: 32 }),
  });

  it('ranks a new fast-growing repository above a high-star one with no recent push', () => {
    const a = scoreDiscovery(rising, corpus);
    const b = scoreDiscovery(dormant, corpus);
    expect(a.scores.total).toBeGreaterThan(b.scores.total);
    expect(a.scores.momentum).toBeGreaterThan(60);
    expect(a.scores.novelty).toBeGreaterThan(b.scores.novelty);
  });

  it('caps momentum for the inactive repository and says why', () => {
    const b = scoreDiscovery(dormant, corpus);
    expect(b.scores.momentum).toBeLessThanOrEqual(8);
    expect(b.reasons).toContain('No commits pushed in 190 days');
  });

  it('describes observed growth using our own snapshots', () => {
    const a = scoreDiscovery(rising, corpus);
    expect(a.reasons.some((r) => r.startsWith('+900 stars across 6 h of our own snapshots'))).toBe(true);
  });

  it('labels a lifetime average as not yet a measured velocity', () => {
    const result = scoreDiscovery(input({ repo: repo({ stars: 1000, createdAt: daysAgo(10) }), growth: growth({ starsPerDayLifetime: 100 }) }), corpus);
    const reason = result.reasons.find((r) => r.includes('since it was created'));
    expect(reason).toContain('not yet a measured velocity');
    expect(result.scores.momentum).toBeGreaterThan(0);
  });

  it('gives an emerging low-star project a gem score and a 20k-star project none', () => {
    const emerging = scoreDiscovery(input({ repo: repo({ stars: 180, forks: 9 }), confidence: 72 }), corpus);
    const famous = scoreDiscovery(input({ repo: repo({ stars: 20_000, forks: 1800 }), confidence: 72 }), corpus);
    expect(emerging.scores.gem).toBeGreaterThan(0);
    expect(emerging.flags).toContain('low-visibility');
    expect(famous.scores.gem).toBe(0);
    expect(famous.flags).not.toContain('low-visibility');
  });

  it('withholds the gem score when confidence is weak', () => {
    expect(scoreDiscovery(input({ repo: repo({ stars: 180 }), confidence: 45 }), corpus).scores.gem).toBe(0);
  });

  it('halves momentum, flags and explains an engagement anomaly, and zeroes the gem score', () => {
    const base = input({
      repo: repo({ stars: 800, pushedAt: hoursAgo(2) }),
      growth: growth({ observedDelta: 30, observedHours: 6, starsPerDayObserved: 120, starsPerDayLifetime: 40, snapshots: 2 }),
    });
    const clean = scoreDiscovery(base, corpus);
    const flagged = scoreDiscovery({ ...base, anomaly: true, anomalyReason: '800 stars but only 2 forks and no open issues' }, corpus);

    expect(clean.scores.momentum).toBeGreaterThan(20);
    expect(clean.scores.momentum).toBeLessThan(100);
    expect(flagged.scores.momentum).toBeCloseTo(clean.scores.momentum / 2, 1);
    expect(flagged.flags).toContain('engagement-anomaly');
    expect(clean.flags).not.toContain('engagement-anomaly');
    expect(flagged.reasons).toContain('Engagement looks unusual (800 stars but only 2 forks and no open issues); momentum is discounted');
    expect(clean.scores.gem).toBeGreaterThan(0);
    expect(flagged.scores.gem).toBe(0);
    expect(flagged.scores.total).toBeLessThan(clean.scores.total);
  });

  it.each([
    ['no growth record', input({ growth: null })],
    ['a growth record with nothing observed', input({ growth: growth({ snapshots: 0 }) })],
    ['no repository dates', input({ growth: growth(), repo: repo({ createdAt: null, pushedAt: null }), publishedAt: null, lastActivityAt: null })],
    ['no repository record at all', input({ repo: null, growth: null })],
  ])('produces finite scores with %s', (_label, scoringInput) => {
    const result = scoreDiscovery(scoringInput, corpus);
    for (const [name, value] of Object.entries(result.scores)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(100);
    }
    // With nothing measured there is no growth claim to make.
    expect(result.reasons.some((r) => /stars across|a day/.test(r))).toBe(false);
  });

  it('marks list-style repositories', () => {
    const result = scoreDiscovery(input({ text: 'A curated list of awesome LLM resources', repo: repo({ stars: 300 }) }), corpus);
    expect(result.flags).toContain('list');
    expect(result.scores.gem).toBe(0);
  });
});

describe('scoreDiscovery: freshness', () => {
  it('scores a stale publication low and a fresh one high', () => {
    const stale = scoreDiscovery(article({ publishedAt: daysAgo(30), firstDiscoveredAt: daysAgo(29) }), corpus);
    const fresh = scoreDiscovery(article({ publishedAt: hoursAgo(2), firstDiscoveredAt: hoursAgo(1) }), corpus);
    expect(stale.scores.freshness).toBeLessThan(5);
    expect(fresh.scores.freshness).toBeGreaterThan(90);
  });

  it('falls back to the discovery date when nothing else is dated', () => {
    const result = scoreDiscovery(article({ publishedAt: null, lastActivityAt: null, firstDiscoveredAt: hoursAgo(96) }), corpus);
    expect(result.scores.freshness).toBeCloseTo(50, 0);
  });
});

describe('scoreDiscovery: coverage', () => {
  it('gives an article referenced by three independent sources more momentum than a single-source one', () => {
    const single = scoreDiscovery(article(), corpus);
    const triple = scoreDiscovery(
      article({ refs: [news('arstechnica', 'Ars Technica'), news('techcrunch', 'TechCrunch'), news('theverge', 'The Verge')] }),
      corpus,
    );
    expect(triple.scores.momentum).toBeGreaterThan(single.scores.momentum);
    expect(triple.scores.significance).toBeGreaterThan(single.scores.significance);
    expect(triple.reasons).toContain('Reported by 3 independent sources: Ars Technica, TechCrunch, The Verge');
    expect(single.reasons.some((r) => r.startsWith('Reported by'))).toBe(false);
  });

  it('counts two feeds with the same owner once', () => {
    const papers = ref({ group: 'research', owner: 'huggingface', sourceName: 'Hugging Face Papers', isPrimary: false });
    const models = ref({ group: 'research', owner: 'huggingface', sourceName: 'Hugging Face Models', isPrimary: false });
    const ars = news('arstechnica', 'Ars Technica');
    expect(independentRefs([papers, models, ars])).toEqual([papers, ars]);

    const oneFeed = scoreDiscovery(article({ refs: [papers] }), corpus);
    const twoFeedsOneOwner = scoreDiscovery(article({ refs: [papers, models] }), corpus);
    expect(twoFeedsOneOwner.scores.momentum).toBe(oneFeed.scores.momentum);
    expect(twoFeedsOneOwner.scores.significance).toBe(oneFeed.scores.significance);
    expect(twoFeedsOneOwner.reasons.some((r) => r.startsWith('Reported by'))).toBe(false);
  });

  it('does not count the primary source as an independent reference', () => {
    expect(independentRefs([ref(), hackerNews(120)])).toHaveLength(1);
    expect(independentRefs([ref()])).toHaveLength(0);
  });

  it('mentions strong community discussion', () => {
    const result = scoreDiscovery(article({ refs: [news('arstechnica', 'Ars Technica'), hackerNews(340, 120)] }), corpus);
    expect(result.reasons).toContain('Hacker News: 340 points, 120 comments');
  });
});

describe('scoreDiscovery: quality gate', () => {
  it('adds the limited-evidence reason below the gate only', () => {
    const below = scoreDiscovery(input({ confidence: QUALITY_GATE - 1 }), corpus);
    const at = scoreDiscovery(input({ confidence: QUALITY_GATE }), corpus);
    expect(below.reasons).toContain('Evidence is limited; held out of featured sections until verified');
    expect(at.reasons.some((r) => r.startsWith('Evidence is limited'))).toBe(false);
  });

  it('uses confidence as the credibility component, clamped to 0..100', () => {
    expect(scoreDiscovery(input({ confidence: 64 }), corpus).scores.credibility).toBe(64);
    expect(scoreDiscovery(input({ confidence: 140 }), corpus).scores.credibility).toBe(100);
  });
});

describe('scoreDiscovery: total', () => {
  const weightedSum = (scores: ReturnType<typeof scoreDiscovery>['scores'], w: Weights) =>
    w.novelty * scores.novelty + w.momentum * scores.momentum + w.significance * scores.significance +
    w.credibility * scores.credibility + w.usefulness * scores.usefulness + w.freshness * scores.freshness;

  it.each([
    ['a repository', input({ growth: growth({ observedDelta: 30, observedHours: 6, starsPerDayObserved: 120, snapshots: 2 }) })],
    ['an article', article({ refs: [news('arstechnica', 'Ars Technica'), hackerNews(90, 40)] })],
  ])('equals the weighted sum of the components for %s', (_label, scoringInput) => {
    const { scores } = scoreDiscovery(scoringInput, corpus);
    // Components are rounded to one decimal, so allow for accumulated rounding.
    expect(Math.abs(scores.total - weightedSum(scores, DEFAULT_WEIGHTS))).toBeLessThanOrEqual(0.11);
  });

  it('honours custom weights', () => {
    const custom = resolveWeights('{"novelty":0,"momentum":1,"significance":0,"credibility":0,"usefulness":0,"freshness":0}').weights;
    const { scores } = scoreDiscovery(input({ growth: growth({ observedDelta: 30, observedHours: 6, starsPerDayObserved: 120, snapshots: 2 }) }), corpus, custom);
    expect(scores.total).toBe(scores.momentum);
  });
});

describe('resolveWeights', () => {
  const sum = (w: Weights) => Object.values(w).reduce((a, b) => a + b, 0);

  it('uses defaults that sum to 1', () => {
    const { weights, version } = resolveWeights(undefined);
    expect(weights).toEqual(DEFAULT_WEIGHTS);
    expect(version).toBe(WEIGHTS_VERSION);
    expect(sum(weights)).toBeCloseTo(1, 10);
  });

  it('renormalises a custom override to 1', () => {
    const { weights, version } = resolveWeights('{"novelty":0.5,"momentum":0.5}');
    expect(sum(weights)).toBeCloseTo(1, 10);
    expect(weights.novelty).toBe(weights.momentum);
    expect(weights.novelty).toBeGreaterThan(weights.significance);
    // Untouched weights keep their relative proportions.
    expect(weights.significance / weights.usefulness).toBeCloseTo(DEFAULT_WEIGHTS.significance / DEFAULT_WEIGHTS.usefulness, 10);
    expect(version.startsWith('custom:')).toBe(true);
  });

  it('ignores invalid values inside an otherwise valid override', () => {
    const { weights } = resolveWeights('{"novelty":-3,"momentum":"lots","freshness":null,"unknown":9}');
    expect(sum(weights)).toBeCloseTo(1, 10);
    for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) expect(weights[key]).toBeCloseTo(DEFAULT_WEIGHTS[key], 10);
    expect(Object.keys(weights).sort()).toEqual(Object.keys(DEFAULT_WEIGHTS).sort());
  });

  it.each([['not json'], ['{"novelty":'], ['null'], ['']])('falls back to the defaults for %j', (raw) => {
    expect(resolveWeights(raw)).toEqual({ weights: DEFAULT_WEIGHTS, version: WEIGHTS_VERSION });
  });

  it('falls back to the defaults when every weight is zero', () => {
    const raw = '{"novelty":0,"momentum":0,"significance":0,"credibility":0,"usefulness":0,"freshness":0}';
    expect(resolveWeights(raw)).toEqual({ weights: DEFAULT_WEIGHTS, version: WEIGHTS_VERSION });
  });
});
