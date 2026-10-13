/**
 * Feed logic shared by the Next.js app (server side) and the Artifact (in the
 * browser): searching, filtering, sorting, diversity and the Today layout.
 * Pure functions over `DiscoveryView[]`; no I/O.
 */
import { CATEGORY_IDS, type CategoryId, type DiscoveryView, type SourceGroup } from '@/lib/types';
import { contentOpportunity } from '@/lib/creator/templates';
import { INDUSTRIES } from '@/lib/industries';

export const SORTS = [
  { id: 'trending', name: 'Trending', hint: 'Overall score, with one owner or source kept from dominating.' },
  { id: 'latest', name: 'Latest', hint: 'Most recently picked up first.' },
  { id: 'momentum', name: 'Fastest growing', hint: 'Measured growth: observed star velocity, releases and discussion.' },
  { id: 'innovative', name: 'Most innovative', hint: 'Novelty and technical significance.' },
  { id: 'useful', name: 'Most useful', hint: 'Licence, documentation, releases and install paths.' },
  { id: 'gems', name: 'Hidden gems', hint: 'Low-visibility projects that score well on novelty.' },
  { id: 'open-source', name: 'Open source', hint: 'Projects with public code.' },
  { id: 'verified', name: 'Verified breakthroughs', hint: 'High confidence and referenced by at least two independent sources.' },
  { id: 'content', name: 'Best story potential', hint: 'New, explainable and verified, and not yet widely covered.' },
] as const;
export type SortId = (typeof SORTS)[number]['id'];

export const WINDOWS = [
  { id: '24h', name: '24 hours', hours: 24 },
  { id: '7d', name: '7 days', hours: 168 },
  { id: '30d', name: '30 days', hours: 720 },
  { id: 'all', name: 'All time', hours: null },
] as const;
export type WindowId = (typeof WINDOWS)[number]['id'];

export const REPO_AGES = [
  { id: 'any', name: 'Any age', days: null },
  { id: 'week', name: 'Under a week', days: 7 },
  { id: 'month', name: 'Under a month', days: 30 },
  { id: 'year', name: 'Under a year', days: 365 },
] as const;
export type RepoAgeId = (typeof REPO_AGES)[number]['id'];

export const ACTIVITY = [
  { id: 'any', name: 'Any activity', days: null },
  { id: 'day', name: 'Pushed in 24 h', days: 1 },
  { id: 'week', name: 'Pushed this week', days: 7 },
] as const;
export type ActivityId = (typeof ACTIVITY)[number]['id'];

export interface FeedQuery {
  q: string;
  category: CategoryId | 'all';
  sort: SortId;
  window: WindowId;
  language: string;
  age: RepoAgeId;
  activity: ActivityId;
  /** Industry id from lib/industries.ts, or empty for all. */
  industry: string;
  page: number;
}

export const DEFAULT_QUERY: FeedQuery = { q: '', category: 'all', sort: 'trending', window: 'all', language: '', age: 'any', activity: 'any', industry: '', page: 1 };
export const PAGE_SIZE = 24;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Parses untrusted URL parameters into a valid query. Unknown values fall back to defaults. */
export function parseQuery(params: Record<string, string | string[] | undefined>, defaults: Partial<FeedQuery> = {}): FeedQuery {
  const get = (k: string) => (Array.isArray(params[k]) ? params[k]?.[0] : params[k]) as string | undefined;
  const base = { ...DEFAULT_QUERY, ...defaults };
  const page = Number.parseInt(get('page') ?? '', 10);
  return {
    q: (get('q') ?? base.q).slice(0, 120).trim(),
    category: oneOf(get('category'), ['all', ...CATEGORY_IDS], base.category),
    sort: oneOf(get('sort'), SORTS.map((s) => s.id), base.sort),
    window: oneOf(get('window'), WINDOWS.map((w) => w.id), base.window),
    language: (get('language') ?? base.language).slice(0, 40).replace(/[^\w+#. -]/g, ''),
    age: oneOf(get('age'), REPO_AGES.map((a) => a.id), base.age),
    activity: oneOf(get('activity'), ACTIVITY.map((a) => a.id), base.activity),
    industry: oneOf(get('industry'), ['', ...INDUSTRIES.map((i) => i.id)], base.industry),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 50) : 1,
  };
}

/** Serialises only what differs from the defaults, so shared links stay short. */
export function toSearchParams(query: FeedQuery, defaults: Partial<FeedQuery> = {}): string {
  const base = { ...DEFAULT_QUERY, ...defaults };
  const out = new URLSearchParams();
  for (const key of ['q', 'category', 'sort', 'window', 'language', 'age', 'activity', 'industry'] as const) {
    if (query[key] && query[key] !== base[key]) out.set(key, query[key]);
  }
  if (query.page > 1) out.set('page', String(query.page));
  return out.toString();
}

export function isDefaultQuery(query: FeedQuery, defaults: Partial<FeedQuery> = {}): boolean {
  return toSearchParams({ ...query, page: 1 }, defaults) === '';
}

export interface FeedPrefs {
  hiddenCategories: CategoryId[];
  hiddenGroups: SourceGroup[];
}

/** The date a time window applies to: publication (creation for repositories), else first sighting. */
export function eventDate(d: DiscoveryView): number {
  return new Date(d.publishedAt ?? d.firstDiscoveredAt).getTime();
}

const primaryGroup = (d: DiscoveryView): SourceGroup => (d.sources.find((s) => s.primary) ?? d.sources[0])?.group ?? 'community';
export const independentSourceCount = (d: DiscoveryView): number => new Set(d.sources.filter((s) => !s.primary).map((s) => s.sourceId)).size;
export const isOpenSource = (d: DiscoveryView): boolean => d.kind === 'repository' || d.evidence.some((e) => e.check === 'code_available' && e.outcome === 'pass');
export const passesGate = (d: DiscoveryView): boolean => d.status === 'verified' || d.confidenceLevel === 'low';
export const isVerifiedBreakthrough = (d: DiscoveryView): boolean => d.confidence >= 75 && independentSourceCount(d) >= 2;

function matchesSearch(d: DiscoveryView, terms: string[]): number {
  if (!terms.length) return 1;
  const title = `${d.title} ${d.headline}`.toLowerCase();
  const rest = `${d.summary} ${d.tags.join(' ')} ${d.repo ? `${d.repo.owner}/${d.repo.name} ${d.repo.language ?? ''} ${d.repo.topics.join(' ')}` : ''} ${d.author ?? ''} ${d.sources.map((s) => s.sourceName).join(' ')}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 3;
    else if (rest.includes(t)) score += 1;
    else return 0;
  }
  return score;
}

const SORTERS: Record<SortId, (d: DiscoveryView) => number> = {
  trending: (d) => d.scores.total,
  latest: (d) => new Date(d.firstDiscoveredAt).getTime() / 1e6 + eventDate(d) / 1e9,
  momentum: (d) => d.scores.momentum,
  innovative: (d) => 0.6 * d.scores.novelty + 0.4 * d.scores.significance,
  useful: (d) => d.scores.usefulness + d.scores.credibility * 0.2,
  gems: (d) => d.scores.gem,
  'open-source': (d) => d.scores.total,
  verified: (d) => d.scores.significance + d.scores.credibility * 0.5,
  content: (d) => contentOpportunity(d).score,
};

/**
 * Greedy re-rank: each time an owner, source or category is repeated its next
 * item is discounted, so one prolific organisation or outlet cannot fill a page.
 */
export function diversify(items: DiscoveryView[], score: (d: DiscoveryView) => number, lookahead = 40): DiscoveryView[] {
  const pool = [...items];
  const out: DiscoveryView[] = [];
  const owners = new Map<string, number>();
  const sources = new Map<string, number>();
  const categories = new Map<string, number>();
  const ownerOf = (d: DiscoveryView) => (d.repo?.owner ?? d.author ?? hostOf(d.canonicalUrl)).toLowerCase();
  const sourceOf = (d: DiscoveryView) => (d.sources.find((s) => s.primary) ?? d.sources[0])?.sourceId ?? 'unknown';
  while (pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < Math.min(lookahead, pool.length); i++) {
      const d = pool[i];
      const adjusted = score(d) * 0.7 ** (owners.get(ownerOf(d)) ?? 0) * 0.94 ** (sources.get(sourceOf(d)) ?? 0) * 0.97 ** (categories.get(d.category) ?? 0);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = i;
      }
    }
    const [picked] = pool.splice(best, 1);
    out.push(picked);
    owners.set(ownerOf(picked), (owners.get(ownerOf(picked)) ?? 0) + 1);
    // Counts decay with distance so the discount applies to neighbours, not the whole feed.
    if (out.length % 12 === 0) {
      sources.clear();
      categories.clear();
    }
    sources.set(sourceOf(picked), (sources.get(sourceOf(picked)) ?? 0) + 1);
    categories.set(picked.category, (categories.get(picked.category) ?? 0) + 1);
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export interface FeedResult {
  items: DiscoveryView[];
  total: number;
  pageCount: number;
  languages: string[];
}

export interface QueryScope {
  /** Restrict to a subset before the user's filters apply (e.g. repositories only). */
  scope?: (d: DiscoveryView) => boolean;
  /** Include items below the credibility gate. Off for editorial surfaces. */
  includeUnverified?: boolean;
  pageSize?: number;
}

export function queryFeed(all: DiscoveryView[], query: FeedQuery, now: Date | string, prefs: FeedPrefs, opts: QueryScope = {}): FeedResult {
  const nowMs = new Date(now).getTime();
  const windowHours = WINDOWS.find((w) => w.id === query.window)?.hours ?? null;
  const ageDays = REPO_AGES.find((a) => a.id === query.age)?.days ?? null;
  const activityDays = ACTIVITY.find((a) => a.id === query.activity)?.days ?? null;
  const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const scoped = all.filter((d) => (opts.scope ? opts.scope(d) : true));
  const languages = [...new Set(scoped.map((d) => d.repo?.language).filter((l): l is string => Boolean(l)))].sort();

  const relevance = new Map<string, number>();
  let items = scoped.filter((d) => {
    if (!opts.includeUnverified && !passesGate(d)) return false;
    if (prefs.hiddenCategories.includes(d.category) && query.category !== d.category) return false;
    if (prefs.hiddenGroups.includes(primaryGroup(d))) return false;
    if (query.category !== 'all' && d.category !== query.category) return false;
    if (query.industry && !d.industries.includes(query.industry)) return false;
    if (windowHours !== null && nowMs - eventDate(d) > windowHours * 3_600_000) return false;
    if (query.language && d.repo?.language?.toLowerCase() !== query.language.toLowerCase()) return false;
    if (ageDays !== null && (!d.repo?.createdAt || nowMs - new Date(d.repo.createdAt).getTime() > ageDays * 86_400_000)) return false;
    if (activityDays !== null && (!d.repo?.pushedAt || nowMs - new Date(d.repo.pushedAt).getTime() > activityDays * 86_400_000)) return false;
    if (query.sort === 'gems' && d.scores.gem <= 0) return false;
    if (query.sort === 'open-source' && !isOpenSource(d)) return false;
    if (query.sort === 'verified' && !isVerifiedBreakthrough(d)) return false;
    if (query.sort === 'content' && d.status !== 'verified') return false;
    const r = matchesSearch(d, terms);
    if (!r) return false;
    relevance.set(d.id, r);
    return true;
  });

  const sorter = SORTERS[query.sort];
  // With a search term, relevance leads and the chosen sort breaks ties.
  items.sort((a, b) => (terms.length ? (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0) : 0) || sorter(b) - sorter(a) || a.id.localeCompare(b.id));
  if (!terms.length && (query.sort === 'trending' || query.sort === 'open-source' || query.sort === 'innovative' || query.sort === 'momentum')) items = diversify(items, sorter);

  const size = opts.pageSize ?? PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  // "Load more" semantics: page N shows the first N pages.
  return { items: items.slice(0, Math.min(query.page, pageCount) * size), total: items.length, pageCount, languages };
}

export interface TodaySections {
  featured: DiscoveryView | null;
  top: DiscoveryView[];
  repos: DiscoveryView[];
  tools: DiscoveryView[];
  research: DiscoveryView[];
  experiments: DiscoveryView[];
  gems: DiscoveryView[];
  recent: DiscoveryView[];
  unverified: DiscoveryView[];
}

/** Lays out the editorial homepage. An item appears in one section only. */
export function buildToday(all: DiscoveryView[], prefs: FeedPrefs, featuredId: string | null): TodaySections {
  const visible = all.filter((d) => !prefs.hiddenCategories.includes(d.category) && !prefs.hiddenGroups.includes(primaryGroup(d)));
  const gated = visible.filter(passesGate);
  const ranked = diversify([...gated].sort((a, b) => b.scores.total - a.scores.total), (d) => d.scores.total);
  const used = new Set<string>();
  const take = (pool: DiscoveryView[], n: number, pred: (d: DiscoveryView) => boolean = () => true) => {
    const out: DiscoveryView[] = [];
    for (const d of pool) {
      if (out.length >= n) break;
      if (used.has(d.id) || !pred(d)) continue;
      used.add(d.id);
      out.push(d);
    }
    return out;
  };
  const featurable = (d: DiscoveryView) => d.status === 'verified' && d.editorial.what.length > 60;
  const featured = ranked.find((d) => d.id === featuredId && featurable(d)) ?? ranked.find(featurable) ?? ranked[0] ?? null;
  if (featured) used.add(featured.id);

  // With little data, sections shrink so the first one does not swallow everything.
  const size = (max: number) => Math.max(2, Math.min(max, Math.round(gated.length / 5)));
  const top = take(ranked, size(6));
  const byMomentum = [...gated].sort((a, b) => b.scores.momentum - a.scores.momentum);
  const repos = take(diversify(byMomentum, (d) => d.scores.momentum), size(6), (d) => d.kind === 'repository');
  const gems = take([...gated].sort((a, b) => b.scores.gem - a.scores.gem), size(4), (d) => d.scores.gem > 0);
  const research = take(ranked, size(4), (d) => d.category === 'research' || d.kind === 'paper' || d.kind === 'model');
  const experiments = take(ranked, size(4), (d) => d.category === 'gaming-browser' || d.category === 'creative' || d.category === 'robotics');
  const tools = take(ranked, size(4), (d) => ['ai-tools', 'agents', 'dev-tools', 'llms', 'launches'].includes(d.category) && d.kind !== 'paper');
  const recent = take([...gated].sort((a, b) => new Date(b.firstDiscoveredAt).getTime() - new Date(a.firstDiscoveredAt).getTime() || eventDate(b) - eventDate(a)), 8);
  const unverified = visible.filter((d) => !passesGate(d)).sort((a, b) => b.scores.total - a.scores.total).slice(0, 4);
  return { featured, top, repos, tools, research, experiments, gems, recent, unverified };
}
