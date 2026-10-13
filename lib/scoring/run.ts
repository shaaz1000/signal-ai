import { eq } from 'drizzle-orm';
import type { CategoryId, ClaimType, JobSummary, Kind, SourceGroup } from '@/lib/types';
import type { Db } from '@/lib/db/client';
import { discoveries, rankingSnapshots } from '@/lib/db/schema';
import { finishRun, loadContexts, startRun, type Ctx } from '@/lib/db/store';
import type { RunOptions } from '@/lib/ingestion/run';
import { log as rootLog } from '@/lib/utils/log';
import { isoDay } from '@/lib/utils/time';
import { computeGrowth, detectAnomaly } from './growth';
import { scoreDiscovery, type CorpusStats, type ScoringInput } from './signals';
import { resolveWeights } from './weights';

export function scoringInput(ctx: Ctx, now: Date): ScoringInput {
  const last = ctx.snaps.at(-1);
  const release = [...ctx.snaps].reverse().find((s) => s.latestReleaseAt);
  const contributors = [...ctx.snaps].reverse().find((s) => s.contributors != null)?.contributors ?? ctx.p.metadata.contributors ?? null;
  const isRepo = ctx.d.kind === 'repository' && Boolean(last);
  const anomaly = isRepo && last
    ? detectAnomaly({ stars: last.stars, forks: last.forks, openIssues: last.openIssues, createdAt: ctx.p.sourceCreatedAt, snaps: ctx.snaps, now })
    : { anomaly: false, reason: null };
  return {
    now,
    kind: ctx.d.kind as Kind,
    category: ctx.d.categoryId as CategoryId,
    claimType: ctx.d.claimType as ClaimType,
    tags: ctx.tags,
    text: `${ctx.d.title} ${ctx.p.metadata.description ?? ''} ${ctx.p.metadata.readmeExcerpt ?? ''} ${ctx.refs.map((r) => r.description).join(' ')}`.slice(0, 12_000),
    publishedAt: ctx.d.publishedAt,
    firstDiscoveredAt: ctx.d.firstDiscoveredAt,
    lastActivityAt: ctx.d.lastActivityAt,
    confidence: ctx.d.confidence,
    refs: ctx.refs.map((r) => ({
      group: r.source.group as SourceGroup, owner: r.source.owner, sourceName: r.source.name, isPrimary: r.isPrimary, points: r.points, comments: r.comments,
    })),
    repo: isRepo && last
      ? {
          stars: last.stars, forks: last.forks, createdAt: ctx.p.sourceCreatedAt, pushedAt: last.pushedAt, license: ctx.p.license,
          homepage: ctx.p.homepageUrl, readmeLength: ctx.p.metadata.readmeLength ?? 0, releaseAt: release?.latestReleaseAt ?? null,
          releaseTag: release?.latestReleaseTag ?? null, contributors,
        }
      : null,
    growth: isRepo ? computeGrowth(ctx.snaps, ctx.p.sourceCreatedAt, now) : null,
    anomaly: anomaly.anomaly,
    anomalyReason: anomaly.reason,
    hf: ctx.p.metadata.hfLikes != null || ctx.p.metadata.hfDownloads != null
      ? { likes: ctx.p.metadata.hfLikes ?? null, downloads: ctx.p.metadata.hfDownloads ?? null }
      : null,
    hasCode: Boolean(ctx.p.metadata.hasCode) || ctx.d.kind === 'repository',
    aiSignificance: ctx.d.aiSignificance,
  };
}

export function corpusStats(ctxs: Ctx[]): CorpusStats {
  const tagDocFreq = new Map<string, number>();
  for (const c of ctxs) for (const t of new Set(c.tags)) tagDocFreq.set(t, (tagDocFreq.get(t) ?? 0) + 1);
  return { total: ctxs.length, tagDocFreq };
}

/** Recomputes every active discovery's scores and writes one ranking snapshot per day. */
export async function runRanking(db: Db, opts: RunOptions = {}): Promise<JobSummary> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const log = (opts.log ?? rootLog).child({ job: 'rank' });
  const started = Date.now();
  const runId = await startRun(db, 'rank', now);
  const { weights, version } = resolveWeights(env.RANKING_WEIGHTS);
  try {
    const ctxs = await loadContexts(db, { now });
    const corpus = corpusStats(ctxs);
    const day = isoDay(now);
    let errors = 0;
    for (const ctx of ctxs) {
      try {
        const { scores, reasons, flags } = scoreDiscovery(scoringInput(ctx, now), corpus, weights);
        await db.update(discoveries).set({
          scoreTotal: scores.total, scoreNovelty: scores.novelty, scoreMomentum: scores.momentum, scoreSignificance: scores.significance,
          scoreUsefulness: scores.usefulness, scoreFreshness: scores.freshness, scoreGem: scores.gem, reasons, flags, lastRankedAt: now,
        }).where(eq(discoveries.id, ctx.d.id));
        const snapshot = {
          discoveryId: ctx.d.id, computedAt: now, day, total: scores.total, novelty: scores.novelty, momentum: scores.momentum,
          significance: scores.significance, credibility: scores.credibility, usefulness: scores.usefulness, freshness: scores.freshness,
          weightsVersion: version, explanation: reasons,
        };
        await db.insert(rankingSnapshots).values(snapshot).onConflictDoUpdate({
          target: [rankingSnapshots.discoveryId, rankingSnapshots.day],
          set: { ...snapshot, discoveryId: undefined, day: undefined },
        });
      } catch (err) {
        errors++;
        log.error('ranking failed', { id: ctx.d.id, error: (err as Error).message });
      }
    }
    const stats = { ranked: ctxs.length - errors, errors, durationMs: Date.now() - started };
    const status: JobSummary['status'] = errors ? 'degraded' : 'success';
    await finishRun(db, runId, { status, stats }, new Date());
    log.info('ranking finished', { status, weights: version, ...stats });
    return { job: 'rank', status, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats, error: null };
  } catch (err) {
    const error = (err as Error).message;
    await finishRun(db, runId, { status: 'failed', error }, new Date());
    return { job: 'rank', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats: {}, error };
  }
}
