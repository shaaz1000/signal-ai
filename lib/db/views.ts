import { and, count, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import type {
  CategoryId, ClaimType, ConfidenceLevel, DiscoveryStatus, DiscoveryView, ExecutionMode, Kind, RepoView,
  Snapshot, SourceGroup, StatusView, WeeklyEdition,
} from '@/lib/types';
import { computeGrowth, detectAnomaly } from '@/lib/scoring/growth';
import { DAY, HOUR, nextDiscoveryRun } from '@/lib/utils/time';
import type { Db, StorageKind } from './client';
import { discoveries, editions } from './schema';
import { ACTIVE_STATUSES, lastRun, loadContexts, type Ctx } from './store';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function repoView(ctx: Ctx, now: Date): RepoView | null {
  if (ctx.d.kind !== 'repository') return null;
  const [owner, name] = ctx.p.name.split('/');
  const last = ctx.snaps.at(-1);
  const withRelease = [...ctx.snaps].reverse().find((s) => s.latestReleaseTag);
  const withContributors = [...ctx.snaps].reverse().find((s) => s.contributors != null);
  const growth = computeGrowth(ctx.snaps, ctx.p.sourceCreatedAt, now);
  const anomaly = last
    ? detectAnomaly({ stars: last.stars, forks: last.forks, openIssues: last.openIssues, createdAt: ctx.p.sourceCreatedAt, snaps: ctx.snaps, now }).anomaly
    : false;
  return {
    owner: owner ?? ctx.p.owner ?? '',
    name: name ?? ctx.p.name,
    language: ctx.p.primaryLanguage,
    license: ctx.p.license,
    stars: last?.stars ?? null,
    forks: last?.forks ?? null,
    openIssues: last?.openIssues ?? null,
    contributors: withContributors?.contributors ?? ctx.p.metadata.contributors ?? null,
    createdAt: iso(ctx.p.sourceCreatedAt),
    pushedAt: iso(last?.pushedAt),
    topics: ctx.p.metadata.topics ?? [],
    latestRelease: withRelease?.latestReleaseTag ? { tag: withRelease.latestReleaseTag, publishedAt: iso(withRelease.latestReleaseAt) } : null,
    growth,
    anomaly,
  };
}

export function toView(ctx: Ctx, now: Date): DiscoveryView {
  const { d } = ctx;
  return {
    id: d.id,
    kind: d.kind as Kind,
    title: d.title,
    headline: d.headline,
    summary: d.summary,
    category: d.categoryId as CategoryId,
    tags: ctx.tags,
    claimType: d.claimType as ClaimType,
    executionMode: (d.executionMode as ExecutionMode | null) ?? null,
    canonicalUrl: d.canonicalUrl,
    author: d.author,
    authorVerified: d.authorVerified,
    publishedAt: iso(d.publishedAt),
    firstDiscoveredAt: d.firstDiscoveredAt.toISOString(),
    lastVerifiedAt: iso(d.lastVerifiedAt),
    lastActivityAt: iso(d.lastActivityAt),
    status: d.status as DiscoveryStatus,
    confidence: d.confidence,
    confidenceLevel: d.confidenceLevel as ConfidenceLevel,
    scores: {
      total: d.scoreTotal, novelty: d.scoreNovelty, momentum: d.scoreMomentum, significance: d.scoreSignificance,
      credibility: d.confidence, usefulness: d.scoreUsefulness, freshness: d.scoreFreshness, gem: d.scoreGem,
    },
    reasons: d.reasons,
    credibilityFactors: d.credibilityFactors,
    evidence: ctx.evidence.map((e) => ({ check: e.check, outcome: e.outcome as DiscoveryView['evidence'][number]['outcome'], detail: e.detail, url: e.evidenceUrl })),
    sources: ctx.refs.map((r) => ({
      sourceId: r.sourceId, sourceName: r.source.name, group: r.source.group as SourceGroup, url: r.url, title: r.title,
      publishedAt: iso(r.publishedAt), primary: r.isPrimary, points: r.points, comments: r.comments,
    })),
    editorial: d.editorial ?? {
      what: d.summary || 'Awaiting verification.',
      why: 'This item has been collected but not yet verified, so no evidence is available.',
      how: null,
      whoCares: '',
      limitations: ['Not verified yet.'],
      applications: null,
      method: 'extractive',
      model: null,
    },
    repo: repoView(ctx, now),
    flags: d.flags,
    fixture: d.origin === 'fixture',
  };
}

export async function loadViews(db: Db, now: Date, opts: { ids?: string[]; limit?: number } = {}): Promise<DiscoveryView[]> {
  const ctxs = await loadContexts(db, { ids: opts.ids, limit: opts.limit, now, statuses: ACTIVE_STATUSES });
  return ctxs.map((c) => toView(c, now));
}

export async function loadView(db: Db, id: string, now: Date): Promise<DiscoveryView | null> {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  const [ctx] = await loadContexts(db, { ids: [id], now });
  if (!ctx || ctx.d.status === 'rejected') return null;
  return toView(ctx, now);
}

export async function loadStatus(db: Db, storage: StorageKind, now: Date): Promise<StatusView> {
  const active = inArray(discoveries.status, ACTIVE_STATUSES);
  const one = async (where: ReturnType<typeof and>) => (await db.select({ n: count() }).from(discoveries).where(where))[0]?.n ?? 0;
  const [total, last24h, last7d, verified, unverified, ingested] = await Promise.all([
    one(active),
    one(and(active, gte(discoveries.firstDiscoveredAt, new Date(now.getTime() - DAY)))),
    one(and(active, gte(discoveries.firstDiscoveredAt, new Date(now.getTime() - 7 * DAY)))),
    one(eq(discoveries.status, 'verified')),
    one(inArray(discoveries.status, ['unverified', 'candidate'])),
    one(and(active, ne(discoveries.origin, 'fixture'))),
  ]);
  const lastIngestion = await lastRun(db, 'discover');
  const finished = lastIngestion?.finishedAt ? new Date(lastIngestion.finishedAt).getTime() : 0;
  return {
    generatedAt: now.toISOString(),
    lastIngestion,
    lastVerification: await lastRun(db, 'verify'),
    lastRanking: await lastRun(db, 'rank'),
    lastCuration: await lastRun(db, 'curate'),
    nextScheduledIngestion: nextDiscoveryRun(now).toISOString(),
    counts: { total, last24h, last7d, verified, unverified },
    // Two missed 3-hourly runs.
    stale: total > 0 && ingested > 0 && now.getTime() - finished > 7 * HOUR,
    dataMode: total === 0 ? 'empty' : ingested === 0 ? 'fixture' : 'ingested',
    storage,
  };
}

export async function loadEdition(db: Db, kind: 'daily' | 'weekly') {
  const [row] = await db.select().from(editions).where(eq(editions.kind, kind)).orderBy(desc(editions.periodStart)).limit(1);
  return row ?? null;
}

export async function loadWeekly(db: Db): Promise<WeeklyEdition | null> {
  const row = await loadEdition(db, 'weekly');
  return row && 'sections' in row.payload ? row.payload : null;
}

export async function buildSnapshot(db: Db, storage: StorageKind, now: Date, limit = 400): Promise<Snapshot> {
  const [status, views, weekly, daily] = await Promise.all([
    loadStatus(db, storage, now), loadViews(db, now), loadWeekly(db), loadEdition(db, 'daily'),
  ]);
  // Best-ranked overall, then a floor per category, kind and section so no area of the product is empty.
  const keep = new Set(views.slice(0, Math.round(limit * 0.55)).map((v) => v.id));
  const top = (pool: DiscoveryView[], n: number) => pool.slice(0, n).forEach((v) => keep.add(v.id));
  const groupBy = (key: (v: DiscoveryView) => string) => {
    const m = new Map<string, DiscoveryView[]>();
    for (const v of views) m.set(key(v), [...(m.get(key(v)) ?? []), v]);
    return [...m.values()];
  };
  for (const g of groupBy((v) => v.category)) top(g, 28);
  for (const g of groupBy((v) => v.kind)) top(g, 28);
  top([...views].filter((v) => v.scores.gem > 0).sort((a, b) => b.scores.gem - a.scores.gem), 60);
  top([...views].sort((a, b) => b.firstDiscoveredAt.localeCompare(a.firstDiscoveredAt) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')), 40);
  top(views.filter((v) => v.confidenceLevel === 'unverified'), 24);
  for (const s of weekly?.sections ?? []) for (const id of s.ids) keep.add(id);
  return {
    schemaVersion: 1,
    status: { ...status, storage: 'snapshot' },
    discoveries: views.filter((v) => keep.has(v.id)),
    weekly,
    featuredId: daily?.featuredId ?? null,
  };
}
