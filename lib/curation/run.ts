import { and, eq, inArray, lt, or, sql, isNull } from 'drizzle-orm';
import { categoryName, type CategoryId, type DiscoveryView, type JobSummary, type WeeklyEdition } from '@/lib/types';
import type { Db } from '@/lib/db/client';
import {
  abuseEvents, credibilityAssessments, discoveries, editions, generationJobs, ingestionRuns, rankingSnapshots, repoMetricSnapshots, tags, trendSnapshots, usageCounters,
} from '@/lib/db/schema';
import { finishRun, startRun } from '@/lib/db/store';
import { loadViews } from '@/lib/db/views';
import { buildToday } from '@/lib/feed/query';
import type { RunOptions } from '@/lib/ingestion/run';
import { FEATURE_GATE } from '@/lib/scoring/weights';
import { log as rootLog } from '@/lib/utils/log';
import { DAY, isoDay, mondayOf, shortDate } from '@/lib/utils/time';

/** Builds the weekly "What you missed" edition from verified discoveries only. Pure. */
export function buildWeekly(views: DiscoveryView[], now: Date): WeeklyEdition {
  const end = now;
  const start = new Date(now.getTime() - 7 * DAY);
  const inWeek = views.filter((v) => new Date(v.firstDiscoveredAt).getTime() >= start.getTime());
  const eligible = inWeek.filter((v) => v.status === 'verified' && v.confidence >= FEATURE_GATE && !v.fixture).sort((a, b) => b.scores.total - a.scores.total);

  const byCategory = new Map<CategoryId, DiscoveryView[]>();
  for (const v of eligible) {
    const list = byCategory.get(v.category) ?? [];
    if (list.length < 3) list.push(v);
    byCategory.set(v.category, list);
  }
  const sections = [...byCategory.entries()]
    .sort((a, b) => b[1][0].scores.total - a[1][0].scores.total)
    .slice(0, 6)
    .map(([category, items]) => ({ category, ids: items.map((i) => i.id) }));

  const counts = new Map<CategoryId, number>();
  for (const v of inWeek) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${categoryName(c).toLowerCase()} (${n})`);
  const sourceCount = new Set(inWeek.flatMap((v) => v.sources.map((s) => s.sourceId))).size;
  const intro = inWeek.length
    ? `Between ${shortDate(start.toISOString())} and ${shortDate(end.toISOString())}, SIGNAL picked up ${inWeek.length} new items from ${sourceCount} sources. ${eligible.length} passed verification with at least medium confidence. The busiest areas were ${busiest.join(', ')}.`
    : 'Nothing new was recorded in the last seven days.';

  return { weekStart: start.toISOString(), weekEnd: end.toISOString(), generatedAt: now.toISOString(), intro, sections };
}

/** Daily curation: pick the featured story and refresh the weekly edition. */
export async function runCuration(db: Db, opts: RunOptions = {}): Promise<JobSummary> {
  const now = opts.now ?? new Date();
  const log = (opts.log ?? rootLog).child({ job: 'curate' });
  const runId = await startRun(db, 'curate', now);
  try {
    const views = await loadViews(db, now);
    const today = buildToday(views, { hiddenCategories: [], hiddenGroups: [] }, null);
    const dailyIds = [today.featured, ...today.top].filter((d): d is DiscoveryView => Boolean(d)).map((d) => d.id);
    const upsert = (kind: string, periodStart: string, featuredId: string | null, payload: WeeklyEdition | { ids: string[] }) =>
      db.insert(editions).values({ kind, periodStart, generatedAt: now, featuredId, payload })
        .onConflictDoUpdate({ target: [editions.kind, editions.periodStart], set: { generatedAt: now, featuredId, payload } });

    await upsert('daily', isoDay(now), today.featured?.id ?? null, { ids: dailyIds });
    const weekly = buildWeekly(views, now);
    await upsert('weekly', isoDay(mondayOf(now)), weekly.sections[0]?.ids[0] ?? null, weekly);

    const stats = { featured: today.featured ? 1 : 0, dailyItems: dailyIds.length, weeklyItems: weekly.sections.reduce((n, s) => n + s.ids.length, 0) };
    await finishRun(db, runId, { status: 'success', stats }, new Date());
    log.info('curation finished', stats);
    return { job: 'curate', status: 'success', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats, error: null };
  } catch (err) {
    const error = (err as Error).message;
    await finishRun(db, runId, { status: 'failed', error }, new Date());
    return { job: 'curate', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats: {}, error };
  }
}

export const RETENTION = {
  /** Hourly star snapshots are kept this long, then thinned to one per day. */
  hourlySnapshotDays: 14,
  snapshotDays: 180,
  rankingDays: 90,
  runDays: 60,
  assessmentDays: 120,
  /** Unseen and inactive for this long: archived (hidden, not deleted). */
  archiveAfterDays: 45,
  rejectedDays: 14,
  /** Quota counters, finished jobs and abuse events: operational records, not history worth keeping. */
  usageDays: 14,
  trendDays: 180,
};

/** Weekly archive maintenance. Every statement is safe to run repeatedly. */
export async function runMaintenance(db: Db, opts: RunOptions = {}): Promise<JobSummary> {
  const now = opts.now ?? new Date();
  const log = (opts.log ?? rootLog).child({ job: 'maintain' });
  const runId = await startRun(db, 'maintain', now);
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const affected = (r: unknown[]) => r.length;
  try {
    const thinned = affected(await db.delete(repoMetricSnapshots).where(and(
      lt(repoMetricSnapshots.observedAt, ago(RETENTION.hourlySnapshotDays)),
      sql`${repoMetricSnapshots.id} not in (select max(id) from repo_metric_snapshots group by project_id, substr(bucket, 1, 10))`,
    )).returning({ id: repoMetricSnapshots.id }));
    const expiredSnapshots = affected(await db.delete(repoMetricSnapshots).where(lt(repoMetricSnapshots.observedAt, ago(RETENTION.snapshotDays))).returning({ id: repoMetricSnapshots.id }));
    const rankings = affected(await db.delete(rankingSnapshots).where(lt(rankingSnapshots.computedAt, ago(RETENTION.rankingDays))).returning({ id: rankingSnapshots.id }));
    const runs = affected(await db.delete(ingestionRuns).where(lt(ingestionRuns.startedAt, ago(RETENTION.runDays))).returning({ id: ingestionRuns.id }));
    const assessments = affected(await db.delete(credibilityAssessments).where(lt(credibilityAssessments.assessedAt, ago(RETENTION.assessmentDays))).returning({ id: credibilityAssessments.id }));
    const archived = affected(await db.update(discoveries).set({ status: 'archived' }).where(and(
      inArray(discoveries.status, ['candidate', 'verified', 'unverified']),
      lt(discoveries.lastSeenAt, ago(RETENTION.archiveAfterDays)),
      or(isNull(discoveries.lastActivityAt), lt(discoveries.lastActivityAt, ago(RETENTION.archiveAfterDays))),
      lt(discoveries.scoreTotal, 60),
    )).returning({ id: discoveries.id }));
    const purged = affected(await db.delete(discoveries).where(and(eq(discoveries.status, 'rejected'), lt(discoveries.lastSeenAt, ago(RETENTION.rejectedDays)))).returning({ id: discoveries.id }));
    const orphanTags = affected(await db.delete(tags).where(sql`not exists (select 1 from discovery_tags dt where dt.tag_id = ${tags.id})`).returning({ id: tags.id }));

    const usage = affected(await db.delete(usageCounters).where(lt(usageCounters.windowStart, ago(RETENTION.usageDays))).returning({ key: usageCounters.key }));
    const jobs = affected(await db.delete(generationJobs).where(lt(generationJobs.startedAt, ago(RETENTION.usageDays))).returning({ id: generationJobs.id }));
    const abuse = affected(await db.delete(abuseEvents).where(lt(abuseEvents.createdAt, ago(RETENTION.usageDays))).returning({ id: abuseEvents.id }));
    const trends = affected(await db.delete(trendSnapshots).where(lt(trendSnapshots.day, ago(RETENTION.trendDays).toISOString().slice(0, 10))).returning({ id: trendSnapshots.id }));

    const stats = { usage, jobs, abuse, trends, thinnedSnapshots: thinned, expiredSnapshots, rankings, runs, assessments, archived, purged, orphanTags };
    await finishRun(db, runId, { status: 'success', stats }, new Date());
    log.info('maintenance finished', stats);
    return { job: 'maintain', status: 'success', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats, error: null };
  } catch (err) {
    const error = (err as Error).message;
    await finishRun(db, runId, { status: 'failed', error }, new Date());
    return { job: 'maintain', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats: {}, error };
  }
}
