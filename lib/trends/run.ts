import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { categoryName, type DiscoveryView, type JobSummary, type TrendView } from '@/lib/types';
import type { Db } from '@/lib/db/client';
import { trendSnapshots } from '@/lib/db/schema';
import { finishRun, startRun } from '@/lib/db/store';
import { loadViews } from '@/lib/db/views';
import { passesGate } from '@/lib/feed/query';
import type { RunOptions } from '@/lib/ingestion/run';
import { industryName } from '@/lib/industries';
import { log as rootLog } from '@/lib/utils/log';
import { DAY, isoDay } from '@/lib/utils/time';

type TopicKind = TrendView['kind'];
export interface TopicStats {
  kind: TopicKind;
  topic: string;
  items: number;
  sources: number;
  repos: number;
  papers: number;
  launches: number;
  momentum: number;
  credibility: number;
  topIds: string[];
}

/** A topic needs this many items in the window before it is tracked at all. */
export const MIN_ITEMS = 3;
const WINDOW_DAYS = 7;
const GENERIC_TAGS = new Set(['ai', 'llm', 'open-source', 'dev-tools', 'agents', 'research', 'launch', 'creative', 'robotics', 'browser-experiment', 'show-hn']);

/**
 * Counts what was first seen in the last seven days, per tag, category and
 * industry. Only items that passed the credibility gate count, so a topic
 * cannot trend on unverified material. Pure.
 */
export function computeTopicStats(views: DiscoveryView[], now: Date): TopicStats[] {
  const since = now.getTime() - WINDOW_DAYS * DAY;
  const recent = views.filter((v) => passesGate(v) && !v.fixture && new Date(v.firstDiscoveredAt).getTime() >= since);
  const buckets = new Map<string, DiscoveryView[]>();
  const add = (kind: TopicKind, topic: string, v: DiscoveryView) => {
    const key = `${kind}:${topic}`;
    const list = buckets.get(key);
    if (list) list.push(v);
    else buckets.set(key, [v]);
  };
  for (const v of recent) {
    add('category', v.category, v);
    for (const i of v.industries) add('industry', i, v);
    // Tags that merely restate a category are not trends of their own.
    for (const t of new Set(v.tags)) if (!GENERIC_TAGS.has(t)) add('tag', t, v);
  }
  const out: TopicStats[] = [];
  for (const [key, list] of buckets) {
    if (list.length < MIN_ITEMS) continue;
    const [kind, ...rest] = key.split(':');
    const ranked = [...list].sort((a, b) => b.scores.total - a.scores.total);
    const mean = (f: (v: DiscoveryView) => number) => Math.round((list.reduce((s, v) => s + f(v), 0) / list.length) * 10) / 10;
    out.push({
      kind: kind as TopicKind,
      topic: rest.join(':'),
      items: list.length,
      // Independent publishers and communities, not counting the host of each item.
      sources: new Set(list.flatMap((v) => v.sources.filter((s) => !s.primary).map((s) => s.sourceId))).size,
      repos: list.filter((v) => v.kind === 'repository').length,
      papers: list.filter((v) => v.kind === 'paper').length,
      launches: list.filter((v) => v.kind === 'model' || v.kind === 'product' || v.claimType === 'company_announcement').length,
      momentum: mean((v) => v.scores.momentum),
      credibility: mean((v) => v.scores.credibility),
      topIds: ranked.slice(0, 5).map((v) => v.id),
    });
  }
  return out;
}

export interface TrendHistoryPoint {
  day: string;
  items: number;
  momentum: number;
}

/**
 * Classifies a topic from its own stored history. With one day of history
 * there is no trend to speak of, and the status says so ("new") instead of
 * guessing a direction.
 */
export function classifyTrend(history: TrendHistoryPoint[]): { status: TrendView['status']; previousItems: number | null; reasons: string[] } {
  const sorted = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted.at(-1);
  if (!latest) return { status: 'new', previousItems: null, reasons: [] };
  if (sorted.length < 2) {
    return { status: 'new', previousItems: null, reasons: [`First tracked on ${latest.day}. A direction needs at least two days of snapshots.`] };
  }
  // Compare against the oldest snapshot within the last week, not just yesterday, to smooth daily noise.
  const baseline = sorted.find((p) => p.day >= isoDay(new Date(new Date(`${latest.day}T00:00:00Z`).getTime() - 7 * DAY))) ?? sorted[0];
  const previous = baseline.items;
  const change = previous > 0 ? (latest.items - previous) / previous : 1;
  const span = `${sorted.length} days of snapshots`;
  const delta = `${latest.items} items in the last 7 days, was ${previous} on ${baseline.day}`;
  if (change <= -0.3) return { status: 'declining', previousItems: previous, reasons: [`${delta} (${Math.round(change * 100)}%).`, span] };
  if (change >= 0.5 && latest.items >= 5) return { status: 'accelerating', previousItems: previous, reasons: [`${delta} (+${Math.round(change * 100)}%).`, span] };
  if (sorted.length <= 7 && change > 0) return { status: 'emerging', previousItems: previous, reasons: [`${delta}. Tracked for under a week.`, span] };
  return { status: 'established', previousItems: previous, reasons: [`${delta}. Steady.`, span] };
}

export function topicName(kind: TopicKind, topic: string): string {
  return kind === 'category' ? categoryName(topic) : kind === 'industry' ? industryName(topic) : topic;
}

/** Trend score: the configured ranking signals, averaged over a topic's leading items, plus breadth of coverage. */
export function trendScore(s: Pick<TopicStats, 'items' | 'sources' | 'momentum' | 'credibility'>): number {
  const breadth = Math.min(100, (Math.log10(1 + s.items) / Math.log10(1 + 60)) * 100);
  const coverage = Math.min(100, s.sources * 20);
  return Math.round((0.4 * s.momentum + 0.25 * s.credibility + 0.2 * breadth + 0.15 * coverage) * 10) / 10;
}

export async function loadTrends(db: Db, now: Date): Promise<TrendView[]> {
  const rows = await db.select().from(trendSnapshots).where(gte(trendSnapshots.day, isoDay(new Date(now.getTime() - 30 * DAY)))).orderBy(desc(trendSnapshots.day));
  if (!rows.length) return [];
  const latestDay = rows[0].day;
  const byTopic = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.topicKind}:${r.topic}`;
    byTopic.set(key, [...(byTopic.get(key) ?? []), r]);
  }
  const out: TrendView[] = [];
  for (const list of byTopic.values()) {
    const latest = list[0];
    // A topic missing from the latest snapshot has dropped below the tracking threshold.
    if (latest.day !== latestDay) continue;
    const c = classifyTrend(list.map((r) => ({ day: r.day, items: r.items, momentum: r.momentum })));
    const kind = latest.topicKind as TopicKind;
    out.push({
      kind, topic: latest.topic, name: topicName(kind, latest.topic), status: c.status, items: latest.items, previousItems: c.previousItems,
      sources: latest.sources, repos: latest.repos, papers: latest.papers, momentum: latest.momentum, credibility: latest.credibility,
      score: trendScore(latest), days: list.length, topIds: latest.topIds,
      reasons: [
        ...c.reasons,
        `${latest.repos} repositories, ${latest.papers} papers and ${latest.launches} launches, referenced by ${latest.sources} independent sources.`,
        `Average momentum ${Math.round(latest.momentum)}, average confidence ${Math.round(latest.credibility)}.`,
      ],
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Daily trend analysis: one snapshot per topic per day, upserted, so reruns on the same day are safe. */
export async function runTrends(db: Db, opts: RunOptions = {}): Promise<JobSummary> {
  const now = opts.now ?? new Date();
  const log = (opts.log ?? rootLog).child({ job: 'trends' });
  const runId = await startRun(db, 'trends', now);
  try {
    const stats = computeTopicStats(await loadViews(db, now), now);
    const day = isoDay(now);
    // Topics that fell below the threshold today must not keep a stale row for today.
    const existing = await db.select({ id: trendSnapshots.id, kind: trendSnapshots.topicKind, topic: trendSnapshots.topic }).from(trendSnapshots).where(eq(trendSnapshots.day, day));
    const keep = new Set(stats.map((s) => `${s.kind}:${s.topic}`));
    const stale = existing.filter((e) => !keep.has(`${e.kind}:${e.topic}`)).map((e) => e.id);
    if (stale.length) await db.delete(trendSnapshots).where(and(eq(trendSnapshots.day, day), inArray(trendSnapshots.id, stale)));
    for (const s of stats) {
      const values = { topicKind: s.kind, topic: s.topic, day, items: s.items, sources: s.sources, repos: s.repos, papers: s.papers, launches: s.launches, momentum: s.momentum, credibility: s.credibility, topIds: s.topIds };
      await db.insert(trendSnapshots).values(values).onConflictDoUpdate({ target: [trendSnapshots.topicKind, trendSnapshots.topic, trendSnapshots.day], set: values });
    }
    const summary = { topics: stats.length };
    await finishRun(db, runId, { status: 'success', stats: summary }, new Date());
    log.info('trend analysis finished', summary);
    return { job: 'trends', status: 'success', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats: summary, error: null };
  } catch (err) {
    const error = (err as Error).message;
    await finishRun(db, runId, { status: 'failed', error }, new Date());
    return { job: 'trends', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats: {}, error };
  }
}
