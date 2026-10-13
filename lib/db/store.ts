import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { CATEGORIES, type JobSummary, type ProviderResult } from '@/lib/types';
import type { CandidateGroup } from '@/lib/ingestion/normalize';
import { sameStory, summaryOf } from '@/lib/ingestion/normalize';
import type { RepoFacts, SourceMeta } from '@/lib/ingestion/types';
import type { Logger } from '@/lib/utils/log';
import { DAY } from '@/lib/utils/time';
import type { Db } from './client';
import {
  categories, discoveries, discoveryTags, ingestionRuns, projects, repoMetricSnapshots,
  sourceReferences, sources, tags, verificationEvidence, type ProjectMetadata,
} from './schema';

export type DiscoveryRow = typeof discoveries.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type SnapshotRow = typeof repoMetricSnapshots.$inferSelect;
export type EvidenceRow = typeof verificationEvidence.$inferSelect;
export type RefRow = typeof sourceReferences.$inferSelect & { source: typeof sources.$inferSelect };

export const ACTIVE_STATUSES = ['candidate', 'verified', 'unverified'];

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export const hourBucket = (d: Date) => d.toISOString().slice(0, 13);

/** Keeps the `sources` and `categories` lookup tables in step with the code. */
export async function syncReferenceData(db: Db, metas: SourceMeta[]): Promise<void> {
  for (const m of metas) {
    await db.insert(sources)
      .values({ id: m.id, name: m.name, group: m.group, reliability: m.reliability, owner: m.owner, homepage: m.homepage })
      .onConflictDoUpdate({ target: sources.id, set: { name: m.name, group: m.group, reliability: m.reliability, owner: m.owner, homepage: m.homepage } });
  }
  for (const [i, c] of CATEGORIES.entries()) {
    await db.insert(categories).values({ id: c.id, name: c.name, sort: i })
      .onConflictDoUpdate({ target: categories.id, set: { name: c.name, sort: i } });
  }
}

// ── Job tracking ───────────────────────────────────────────────────────────

export async function startRun(db: Db, job: string, now: Date): Promise<number> {
  // A run left "running" for over an hour was killed mid-flight; close it so status stays truthful.
  await db.update(ingestionRuns)
    .set({ status: 'failed', finishedAt: now, error: 'Abandoned: the worker stopped before finishing' })
    .where(and(eq(ingestionRuns.status, 'running'), sql`${ingestionRuns.startedAt} < ${new Date(now.getTime() - 3_600_000)}`));
  const [row] = await db.insert(ingestionRuns).values({ job, status: 'running', startedAt: now }).returning({ id: ingestionRuns.id });
  return row.id;
}

export async function finishRun(
  db: Db, id: number,
  result: { status: JobSummary['status']; providers?: ProviderResult[]; stats?: Record<string, number>; error?: string | null },
  now: Date,
): Promise<void> {
  await db.update(ingestionRuns)
    .set({ status: result.status, finishedAt: now, providers: result.providers ?? [], stats: result.stats ?? {}, error: result.error ?? null })
    .where(eq(ingestionRuns.id, id));
}

export async function lastRun(db: Db, job: string, onlyFinished = true): Promise<JobSummary | null> {
  const rows = await db.select().from(ingestionRuns)
    .where(onlyFinished ? and(eq(ingestionRuns.job, job), inArray(ingestionRuns.status, ['success', 'degraded'])) : eq(ingestionRuns.job, job))
    .orderBy(desc(ingestionRuns.startedAt)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    job: r.job, status: r.status as JobSummary['status'], startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null, providers: r.providers, stats: r.stats, error: r.error,
  };
}

// ── Persistence (stage 3 output) ───────────────────────────────────────────

export async function upsertSnapshot(
  db: Db, projectId: number, facts: Pick<RepoFacts, 'stars' | 'forks' | 'openIssues' | 'watchers' | 'pushedAt'>, now: Date,
  extra: { contributors?: number | null; releaseTag?: string | null; releaseAt?: Date | null } = {},
): Promise<void> {
  const values = {
    projectId, observedAt: now, bucket: hourBucket(now), stars: facts.stars, forks: facts.forks, openIssues: facts.openIssues,
    watchers: facts.watchers ?? null, pushedAt: facts.pushedAt ?? null,
    contributors: extra.contributors ?? null, latestReleaseTag: extra.releaseTag ?? null, latestReleaseAt: extra.releaseAt ?? null,
  };
  await db.insert(repoMetricSnapshots).values(values).onConflictDoUpdate({
    target: [repoMetricSnapshots.projectId, repoMetricSnapshots.bucket],
    set: {
      observedAt: now, stars: values.stars, forks: values.forks, openIssues: values.openIssues, watchers: values.watchers, pushedAt: values.pushedAt,
      // Search results carry no release or contributor data; never overwrite known values with null.
      contributors: sql`coalesce(${values.contributors}, ${repoMetricSnapshots.contributors})`,
      latestReleaseTag: sql`coalesce(${values.latestReleaseTag}, ${repoMetricSnapshots.latestReleaseTag})`,
      latestReleaseAt: sql`coalesce(${values.latestReleaseAt}, ${repoMetricSnapshots.latestReleaseAt})`,
    },
  });
}

export function repoMetadata(facts: RepoFacts, previous: ProjectMetadata = {}): ProjectMetadata {
  return {
    ...previous,
    description: facts.description ?? previous.description,
    topics: facts.topics.length ? facts.topics : previous.topics,
    isFork: facts.isFork,
    archived: facts.archived,
    hasCode: true,
  };
}

export interface PersistStats {
  created: number;
  updated: number;
  attached: number;
  references: number;
  snapshots: number;
  failed: number;
}

/**
 * Writes grouped candidates. Every statement is an upsert on a unique key, so
 * running the same input twice changes nothing but `last_seen_at`.
 */
export async function persistGroups(db: Db, groups: CandidateGroup[], now: Date, log: Logger, origin = 'ingestion'): Promise<PersistStats> {
  const stats: PersistStats = { created: 0, updated: 0, attached: 0, references: 0, snapshots: 0, failed: 0 };
  if (!groups.length) return stats;

  // Items already attached to a discovery in an earlier run stay attached to it.
  const knownRefs = new Map<string, string>();
  const externalIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.externalId)))];
  for (const part of chunk(externalIds, 500)) {
    const rows = await db.select({ s: sourceReferences.sourceId, e: sourceReferences.externalId, d: sourceReferences.discoveryId })
      .from(sourceReferences).where(inArray(sourceReferences.externalId, part));
    for (const r of rows) knownRefs.set(`${r.s}:${r.e}`, r.d);
  }
  // Recent coverage, for matching today's article to the story we stored yesterday.
  const recentStories = await db.select({ id: discoveries.id, title: discoveries.title, publishedAt: discoveries.publishedAt })
    .from(discoveries)
    .where(and(inArray(discoveries.kind, ['article', 'product']), gte(discoveries.firstDiscoveredAt, new Date(now.getTime() - 6 * DAY))));

  for (const g of groups) {
    try {
      await db.transaction(async (tx) => {
        const t = tx as unknown as Db;
        const [existingProject] = await t.select().from(projects).where(eq(projects.canonicalKey, g.key)).limit(1);
        let discoveryId: string | null = null;
        let attachOnly = false;

        if (existingProject) {
          const [d] = await t.select({ id: discoveries.id, status: discoveries.status }).from(discoveries).where(eq(discoveries.projectId, existingProject.id)).limit(1);
          discoveryId = d?.id ?? null;
          if (d?.status === 'rejected') return;
        } else {
          const viaRef = g.members.map((m) => knownRefs.get(`${m.sourceId}:${m.externalId}`)).find(Boolean);
          const viaStory = g.kind === 'article' || g.kind === 'product' ? recentStories.find((s) => sameStory(s, g))?.id : undefined;
          if (viaRef ?? viaStory) {
            discoveryId = (viaRef ?? viaStory)!;
            attachOnly = true;
          }
        }

        const repo = g.members.find((m) => m.repo)?.repo;
        const refDates = g.members.map((m) => m.publishedAt?.getTime() ?? 0);
        const activity = repo?.pushedAt ?? (Math.max(...refDates) > 0 ? new Date(Math.max(...refDates)) : g.publishedAt);

        if (!attachOnly) {
          const hf = g.members.find((m) => m.hf)?.hf;
          const codeUrl = g.members.find((m) => m.codeUrl)?.codeUrl;
          const metadata: ProjectMetadata = {
            ...(existingProject?.metadata ?? {}),
            ...(repo ? repoMetadata(repo, existingProject?.metadata) : { description: g.description || existingProject?.metadata.description }),
            ...(hf ? { hfLikes: hf.likes, hfDownloads: hf.downloads, hfPipeline: hf.pipeline } : {}),
            ...(codeUrl ? { hasCode: true, codeUrl } : {}),
          };
          const projectValues = {
            canonicalKey: g.key,
            kind: g.kind,
            name: repo ? `${repo.owner}/${repo.name}` : g.title,
            owner: repo?.owner ?? g.author,
            url: g.canonicalUrl,
            homepageUrl: repo?.homepage ?? null,
            primaryLanguage: repo?.language ?? null,
            license: repo?.license ?? null,
            sourceCreatedAt: repo?.createdAt ?? null,
            metadata,
            updatedAt: now,
          };
          const [project] = await t.insert(projects).values(projectValues)
            .onConflictDoUpdate({
              target: projects.canonicalKey,
              set: {
                updatedAt: now, metadata,
                ...(repo ? { primaryLanguage: repo.language, license: repo.license, homepageUrl: repo.homepage, sourceCreatedAt: repo.createdAt, owner: repo.owner } : {}),
              },
            })
            .returning({ id: projects.id });

          if (!discoveryId) {
            discoveryId = g.id;
            await t.insert(discoveries).values({
              id: g.id, projectId: project.id, categoryId: g.category, kind: g.kind, title: g.title, headline: g.title,
              summary: summaryOf(g.description, g.title), canonicalUrl: g.canonicalUrl, author: g.author, authorVerified: g.authorVerified,
              claimType: g.claimType, publishedAt: g.publishedAt, firstDiscoveredAt: now, lastSeenAt: now, lastActivityAt: activity, origin,
            }).onConflictDoNothing({ target: discoveries.id });
            if (g.kind === 'article' || g.kind === 'product') recentStories.push({ id: g.id, title: g.title, publishedAt: g.publishedAt });
            if (g.tags.length) {
              await t.insert(tags).values(g.tags.map((slug) => ({ slug }))).onConflictDoNothing({ target: tags.slug });
              const tagRows = await t.select({ id: tags.id }).from(tags).where(inArray(tags.slug, g.tags));
              await t.insert(discoveryTags).values(tagRows.map((r) => ({ discoveryId: g.id, tagId: r.id }))).onConflictDoNothing();
            }
            stats.created++;
          } else {
            await t.update(discoveries).set({
              lastSeenAt: now,
              lastActivityAt: activity ? sql`greatest(coalesce(${discoveries.lastActivityAt}, ${activity}), ${activity})` : discoveries.lastActivityAt,
              // An archived item that resurfaces goes back through verification.
              status: sql`case when ${discoveries.status} = 'archived' then 'candidate' else ${discoveries.status} end`,
            }).where(eq(discoveries.id, discoveryId));
            stats.updated++;
          }
          if (repo) {
            await upsertSnapshot(t, project.id, repo, now);
            stats.snapshots++;
          }
        } else {
          await t.update(discoveries).set({ lastSeenAt: now }).where(eq(discoveries.id, discoveryId!));
          stats.attached++;
        }

        for (const m of g.members) {
          await t.insert(sourceReferences).values({
            discoveryId: discoveryId!, sourceId: m.sourceId, externalId: m.externalId, url: m.refUrl, title: m.title,
            author: m.author, publishedAt: m.publishedAt, firstSeenAt: now, lastSeenAt: now, isPrimary: m.primary && !attachOnly,
            points: m.points, comments: m.comments, description: m.description.slice(0, 1500),
          }).onConflictDoUpdate({
            target: [sourceReferences.sourceId, sourceReferences.externalId],
            set: { lastSeenAt: now, points: m.points, comments: m.comments, title: m.title },
          });
          knownRefs.set(`${m.sourceId}:${m.externalId}`, discoveryId!);
          stats.references++;
        }
      });
    } catch (err) {
      // One bad group must not sink the batch.
      stats.failed++;
      log.error('persist failed', { key: g.key, error: (err as Error).message });
    }
  }
  return stats;
}

// ── Loading ────────────────────────────────────────────────────────────────

export interface Ctx {
  d: DiscoveryRow;
  p: ProjectRow;
  refs: RefRow[];
  snaps: SnapshotRow[];
  evidence: EvidenceRow[];
  tags: string[];
}

/** Loads discoveries with everything attached, in a fixed number of queries. */
export async function loadContexts(db: Db, opts: { ids?: string[]; statuses?: string[]; now: Date; limit?: number }): Promise<Ctx[]> {
  const statuses = opts.statuses ?? ACTIVE_STATUSES;
  if (opts.ids && opts.ids.length === 0) return [];
  const where = opts.ids ? inArray(discoveries.id, opts.ids) : inArray(discoveries.status, statuses);
  const base = db.select().from(discoveries).where(where).orderBy(desc(discoveries.scoreTotal), desc(discoveries.firstDiscoveredAt));
  const ds = await (opts.limit ? base.limit(opts.limit) : base);
  if (!ds.length) return [];

  const ids = ds.map((d) => d.id);
  const projectIds = ds.map((d) => d.projectId);
  const scoped = Boolean(opts.ids || opts.limit);
  const since = new Date(opts.now.getTime() - 14 * DAY);

  const collect = async <T>(all: () => Promise<T[]>, part: (keys: never[]) => Promise<T[]>, keys: unknown[]): Promise<T[]> => {
    if (!scoped) return all();
    const out: T[] = [];
    for (const c of chunk(keys, 800)) out.push(...(await part(c as never[])));
    return out;
  };

  const ps = await collect(
    () => db.select().from(projects),
    (k: number[]) => db.select().from(projects).where(inArray(projects.id, k)), projectIds);
  const refRows = await collect(
    () => db.select().from(sourceReferences).innerJoin(sources, eq(sources.id, sourceReferences.sourceId)),
    (k: string[]) => db.select().from(sourceReferences).innerJoin(sources, eq(sources.id, sourceReferences.sourceId)).where(inArray(sourceReferences.discoveryId, k)), ids);
  const snaps = await collect(
    () => db.select().from(repoMetricSnapshots).where(gte(repoMetricSnapshots.observedAt, since)).orderBy(asc(repoMetricSnapshots.observedAt)),
    (k: number[]) => db.select().from(repoMetricSnapshots).where(and(inArray(repoMetricSnapshots.projectId, k), gte(repoMetricSnapshots.observedAt, since))).orderBy(asc(repoMetricSnapshots.observedAt)), projectIds);
  const ev = await collect(
    () => db.select().from(verificationEvidence),
    (k: string[]) => db.select().from(verificationEvidence).where(inArray(verificationEvidence.discoveryId, k)), ids);
  const tg = await collect(
    () => db.select({ discoveryId: discoveryTags.discoveryId, slug: tags.slug }).from(discoveryTags).innerJoin(tags, eq(tags.id, discoveryTags.tagId)),
    (k: string[]) => db.select({ discoveryId: discoveryTags.discoveryId, slug: tags.slug }).from(discoveryTags).innerJoin(tags, eq(tags.id, discoveryTags.tagId)).where(inArray(discoveryTags.discoveryId, k)), ids);

  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const projectById = new Map(ps.map((p) => [p.id, p]));
  const refsBy = group(refRows.map((r) => ({ ...r.source_references, source: r.sources }) as RefRow), (r) => r.discoveryId);
  const snapsBy = group(snaps, (s) => s.projectId);
  const evBy = group(ev, (e) => e.discoveryId);
  const tagsBy = group(tg, (t) => t.discoveryId);

  const out: Ctx[] = [];
  for (const d of ds) {
    const p = projectById.get(d.projectId);
    if (!p) continue;
    out.push({
      d, p,
      refs: (refsBy.get(d.id) ?? []).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.source.reliability - a.source.reliability),
      snaps: snapsBy.get(p.id) ?? [],
      evidence: evBy.get(d.id) ?? [],
      tags: (tagsBy.get(d.id) ?? []).map((t) => t.slug),
    });
  }
  return out;
}
