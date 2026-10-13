import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { CategoryId, ClaimType, JobSummary, Kind, SourceGroup } from '@/lib/types';
import type { Db } from '@/lib/db/client';
import { credibilityAssessments, discoveries, modelReleases, projects, repoMetricSnapshots, verificationEvidence, type ProjectMetadata } from '@/lib/db/schema';
import { detectConcept } from '@/lib/explain/concepts';
import { classifyIndustries, detectEvidenceStage } from '@/lib/industries';
import { ACTIVE_STATUSES, finishRun, loadContexts, repoMetadata, startRun, upsertSnapshot, type Ctx } from '@/lib/db/store';
import { resolveProvider, summarize } from '@/lib/ai/provider';
import type { AiProvider, EvidencePack } from '@/lib/ai/types';
import { fetchRepo } from '@/lib/ingestion/sources/github';
import { pool, type RunOptions } from '@/lib/ingestion/run';
import { computeGrowth, detectAnomaly } from '@/lib/scoring/growth';
import { HttpError, request } from '@/lib/utils/http';
import { log as rootLog } from '@/lib/utils/log';
import { fmtInt, plainText } from '@/lib/utils/text';
import { hostOf } from '@/lib/utils/url';
import { DAY, HOUR } from '@/lib/utils/time';
import { assessCredibility, runChecks, statusFor, type Probe, type VerificationInput } from './checks';
import { probeUrl, type HostResolver } from './probe';

export interface VerifyOptions extends RunOptions {
  limit?: number;
  provider?: AiProvider;
  resolveHost?: HostResolver;
  /** Re-verify after this many hours. */
  maxAgeHours?: number;
}

class Budget {
  exhausted = false;
  constructor(private remaining: number) {}
  take(n = 1): boolean {
    if (this.exhausted || this.remaining < n) return false;
    this.remaining -= n;
    return true;
  }
}

/** Facts we measured ourselves, phrased so a summariser can restate them safely. */
function measuredFacts(ctx: Ctx, now: Date): string[] {
  const facts: string[] = [];
  const last = ctx.snaps.at(-1);
  if (ctx.d.kind === 'repository' && last) {
    const created = ctx.p.sourceCreatedAt;
    const age = created ? Math.max(1, Math.round((now.getTime() - created.getTime()) / DAY)) : null;
    facts.push(`The GitHub API reports ${fmtInt(last.stars)} stars and ${fmtInt(last.forks)} forks${age ? `, ${age} days after the repository was created` : ''}.`);
    const g = computeGrowth(ctx.snaps, created, now);
    if (g.observedDelta != null && g.observedHours != null && g.observedDelta > 0) facts.push(`It gained ${fmtInt(g.observedDelta)} stars across ${g.observedHours} hours of our snapshots.`);
    if (ctx.p.primaryLanguage) facts.push(`Primary language: ${ctx.p.primaryLanguage}.`);
    if (ctx.p.license) facts.push(`Licence: ${ctx.p.license}.`);
  }
  if (ctx.p.metadata.hfLikes != null) facts.push(`Hugging Face lists ${fmtInt(ctx.p.metadata.hfLikes)} likes${ctx.p.metadata.hfDownloads ? ` and ${fmtInt(ctx.p.metadata.hfDownloads)} downloads` : ''}.`);
  const community = ctx.refs.filter((r) => r.source.group === 'community' && (r.points ?? 0) > 0).sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
  if (community) facts.push(`${community.source.name} thread: ${community.points} points${community.comments ? `, ${community.comments} comments` : ''}.`);
  const owners = new Set(ctx.refs.filter((r) => !r.isPrimary).map((r) => r.source.owner));
  if (owners.size >= 2) facts.push(`Referenced by ${owners.size} independent sources.`);
  return facts;
}

async function enrichRepository(db: Db, ctx: Ctx, opts: { env: Record<string, string | undefined>; http: RunOptions['http']; now: Date; budget: Budget }): Promise<{ probe: Probe; docs: string }> {
  const [owner, name] = ctx.p.name.split('/');
  const stored = ctx.p.metadata;
  const enrichedAt = stored.enrichedAt ? new Date(stored.enrichedAt).getTime() : 0;
  const lastSnap = ctx.snaps.at(-1);
  const needFull = opts.now.getTime() - enrichedAt > 3 * DAY;
  const fresh = lastSnap && opts.now.getTime() - lastSnap.observedAt.getTime() < 2 * HOUR;

  // Seen by the search API within two hours and already enriched: nothing new to fetch.
  if (!needFull && fresh) return { probe: { state: 'ok', via: 'GitHub API' }, docs: stored.readmeExcerpt ?? '' };
  if (!owner || !name || !opts.budget.take(needFull ? 4 : 1)) {
    return { probe: lastSnap ? { state: 'ok', via: 'GitHub API (earlier this run)' } : { state: 'error', via: 'GitHub request budget for this run was used up' }, docs: stored.readmeExcerpt ?? '' };
  }
  try {
    const repo = await fetchRepo(owner, name, opts.env, opts.http ?? {}, opts.now, needFull ? 'full' : 'metrics');
    if (!repo) return { probe: { state: 'not_found', via: 'GitHub API returned 404' }, docs: '' };
    const metadata: ProjectMetadata = {
      ...repoMetadata(repo.facts, stored),
      ...(needFull
        ? { readmeExcerpt: repo.readme ? repo.readme.slice(0, 6000) : stored.readmeExcerpt, readmeLength: repo.readme?.length ?? stored.readmeLength ?? 0, contributors: repo.contributors ?? stored.contributors ?? null, enrichedAt: opts.now.toISOString() }
        : {}),
    };
    await db.update(projects).set({
      metadata, primaryLanguage: repo.facts.language, license: repo.facts.license, homepageUrl: repo.facts.homepage,
      sourceCreatedAt: repo.facts.createdAt, updatedAt: opts.now,
    }).where(eq(projects.id, ctx.p.id));
    await upsertSnapshot(db, ctx.p.id, repo.facts, opts.now, {
      contributors: repo.contributors, releaseTag: repo.latestRelease?.tag, releaseAt: repo.latestRelease?.publishedAt,
    });
    ctx.p = { ...ctx.p, metadata, primaryLanguage: repo.facts.language, license: repo.facts.license, sourceCreatedAt: repo.facts.createdAt };
    ctx.snaps = await db.select().from(repoMetricSnapshots)
      .where(and(eq(repoMetricSnapshots.projectId, ctx.p.id), gte(repoMetricSnapshots.observedAt, new Date(opts.now.getTime() - 14 * DAY))))
      .orderBy(asc(repoMetricSnapshots.observedAt));
    return { probe: { state: 'ok', via: 'GitHub API' }, docs: metadata.readmeExcerpt ?? '' };
  } catch (err) {
    if (err instanceof HttpError && err.rateLimited) opts.budget.exhausted = true;
    return { probe: { state: 'error', via: (err as Error).message }, docs: stored.readmeExcerpt ?? '' };
  }
}

async function enrichHuggingFace(db: Db, ctx: Ctx, opts: { http: RunOptions['http']; now: Date }): Promise<{ probe: Probe; docs: string }> {
  if (ctx.p.metadata.readmeExcerpt && ctx.p.metadata.enrichedAt && opts.now.getTime() - new Date(ctx.p.metadata.enrichedAt).getTime() < 3 * DAY) {
    return { probe: { state: 'ok', via: 'Hugging Face' }, docs: ctx.p.metadata.readmeExcerpt };
  }
  try {
    const res = await request(`${ctx.d.canonicalUrl}/raw/main/README.md`, { ...opts.http, retries: 1, timeoutMs: 12_000, maxBytes: 120_000 });
    // Drop the YAML front matter; it is configuration, not description.
    const card = res.text.replace(/^---[\s\S]*?---\s*/, '');
    const license = res.text.match(/^---[\s\S]*?^license:\s*([\w.+-]{2,40})\s*$[\s\S]*?^---/m)?.[1];
    const metadata: ProjectMetadata = { ...ctx.p.metadata, ...(license ? { hfLicense: license } : {}), readmeExcerpt: card.slice(0, 6000), readmeLength: card.length, enrichedAt: opts.now.toISOString() };
    await db.update(projects).set({ metadata, updatedAt: opts.now }).where(eq(projects.id, ctx.p.id));
    ctx.p = { ...ctx.p, metadata };
    return { probe: { state: 'ok', via: 'Hugging Face' }, docs: metadata.readmeExcerpt ?? '' };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { probe: { state: 'ok', via: 'Hugging Face listing API (no model card published)' }, docs: '' };
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return { probe: { state: 'ok', via: 'Hugging Face listing API (card is gated)' }, docs: '' };
    return { probe: { state: 'error', via: (err as Error).message }, docs: '' };
  }
}

const MODALITIES: [RegExp, string][] = [
  [/text|chat|feature-extraction|sentence|translation|summar|question/, 'text'],
  [/image|vision|visual|depth|segmentation|object-detection/, 'image'],
  [/audio|speech|voice/, 'audio'],
  [/video/, 'video'],
];

/**
 * Industry, maturity, concept and model facts. Industries and the model
 * record use only the item's own title, description and tags; the stated
 * maturity may also quote its documentation. Nothing here is inferred beyond
 * what those texts say.
 */
export function classifyDiscovery(ctx: Ctx, description: string, docs: string) {
  const own = `${ctx.d.title} ${description} ${ctx.tags.join(' ')}`;
  const industries = classifyIndustries(own);
  const stage = detectEvidenceStage({ text: `${own} ${docs.slice(0, 4000)}`, industries, claimType: ctx.d.claimType });
  const conceptId = detectConcept({ headline: `${ctx.d.title} ${description}`, text: `${ctx.tags.join(' ')} ${docs.slice(0, 2000)}`, kind: ctx.d.kind });

  const isHostedModel = ctx.d.kind === 'model';
  const announcer = ctx.refs.find((r) => r.source.group === 'blog' && r.isPrimary);
  const isAnnouncement = !isHostedModel && Boolean(announcer) && /\b(model|weights|llm)\b/i.test(own) && /\b(releas\w+|introduc\w+|announc\w+|launch\w+|available)\b/i.test(own);
  const pipeline = `${ctx.p.metadata.hfPipeline ?? ''} ${ctx.tags.join(' ')}`;
  const model = isHostedModel || isAnnouncement
    ? {
        vendor: isHostedModel ? ctx.p.owner : announcer?.source.name ?? null,
        // Listed on the Hugging Face hub means the files can be downloaded. An announcement alone says nothing either way.
        openWeights: isHostedModel ? true : /\bopen[- ]weights?\b/i.test(own) ? true : null,
        license: ctx.p.metadata.hfLicense ?? null,
        modalities: [...new Set(MODALITIES.filter(([re]) => re.test(pipeline)).map(([, m]) => m))],
        independentlyTested: stage?.stage === 'independent-validation',
      }
    : null;
  return { industries, stage, conceptId, model };
}

export function buildInput(ctx: Ctx, probe: Probe, docs: string, now: Date): VerificationInput {
  const last = ctx.snaps.at(-1);
  const release = [...ctx.snaps].reverse().find((s) => s.latestReleaseAt);
  const isRepo = ctx.d.kind === 'repository';
  const fallback = ctx.d.summary !== ctx.d.title ? ctx.d.summary : '';
  const description = ctx.p.metadata.description || ctx.refs.find((r) => r.description)?.description || fallback;
  return {
    now,
    kind: ctx.d.kind as Kind,
    category: ctx.d.categoryId,
    claimType: ctx.d.claimType as ClaimType,
    canonicalUrl: ctx.d.canonicalUrl,
    title: ctx.d.title,
    description,
    author: ctx.d.authorVerified ? ctx.d.author : null,
    publishedAt: ctx.d.publishedAt,
    refs: ctx.refs.map((r) => ({
      sourceId: r.sourceId, sourceName: r.source.name, group: r.source.group as SourceGroup, owner: r.source.owner,
      reliability: r.source.reliability, isPrimary: r.isPrimary, url: r.url, title: r.title, description: r.description, publishedAt: r.publishedAt,
    })),
    probe,
    repo: isRepo && last
      ? {
          stars: last.stars, description: ctx.p.metadata.description ?? null, createdAt: ctx.p.sourceCreatedAt, pushedAt: last.pushedAt,
          license: ctx.p.license, releaseAt: release?.latestReleaseAt ?? null, archived: Boolean(ctx.p.metadata.archived), isFork: Boolean(ctx.p.metadata.isFork),
        }
      : null,
    docs,
    hasCode: isRepo || ctx.p.canonicalKey.startsWith('hf-') ? probe.state !== 'not_found' : Boolean(ctx.p.metadata.hasCode),
    codeUrl: ctx.p.metadata.codeUrl ?? (isRepo ? ctx.d.canonicalUrl : null),
    anomaly: isRepo && last
      ? detectAnomaly({ stars: last.stars, forks: last.forks, openIssues: last.openIssues, createdAt: ctx.p.sourceCreatedAt, snaps: ctx.snaps, now })
      : { anomaly: false, reason: null },
  };
}

/**
 * Stages 4 to 6 for a batch: enrich from the primary source, run the checks,
 * score credibility, write the editorial note. Also refreshes metrics for
 * tracked repositories so star velocity comes from real snapshots.
 */
export async function runVerification(db: Db, opts: VerifyOptions = {}): Promise<JobSummary> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const log = (opts.log ?? rootLog).child({ job: 'verify' });
  const provider = opts.provider ?? resolveProvider(env, log);
  const started = Date.now();
  const runId = await startRun(db, 'verify', now);
  const authenticated = Boolean(env.GITHUB_TOKEN);
  // Core API allowance is 5000/h with a token and 60/h without. Leave headroom.
  const budget = new Budget(Number(env.GITHUB_CALL_BUDGET) || (authenticated ? 700 : 30));
  const stats = { refreshed: 0, verified: 0, unverified: 0, rejected: 0, summarisedByModel: 0, guardViolations: 0, errors: 0 };

  try {
    // A. Metric refresh for tracked repositories that this run's search did not return.
    const stale = await db.select({ id: discoveries.id }).from(discoveries)
      .where(and(
        eq(discoveries.kind, 'repository'), inArray(discoveries.status, ['verified', 'unverified']),
        or(gte(discoveries.firstDiscoveredAt, new Date(now.getTime() - 30 * DAY)), gte(discoveries.scoreTotal, 55)),
        sql`not exists (select 1 from ${repoMetricSnapshots} s where s.project_id = ${discoveries.projectId} and s.observed_at > ${new Date(now.getTime() - 2.5 * HOUR)})`,
      ))
      .orderBy(desc(discoveries.scoreTotal)).limit(authenticated ? 250 : 15);
    const staleCtx = await loadContexts(db, { ids: stale.map((s) => s.id), now });
    await pool(staleCtx, 4, async (ctx) => {
      const [owner, name] = ctx.p.name.split('/');
      if (!owner || !name || !budget.take()) return;
      try {
        const repo = await fetchRepo(owner, name, env, opts.http ?? {}, now, 'metrics');
        if (repo) {
          await upsertSnapshot(db, ctx.p.id, repo.facts, now);
          stats.refreshed++;
        }
      } catch (err) {
        if (err instanceof HttpError && err.rateLimited) budget.exhausted = true;
      }
    });

    // B. The verification queue: never-verified first, then the oldest checks.
    const cutoff = new Date(now.getTime() - (opts.maxAgeHours ?? (env.VERIFY_MAX_AGE_HOURS ? Number(env.VERIFY_MAX_AGE_HOURS) : 24)) * HOUR);
    const queue = await db.select({ id: discoveries.id }).from(discoveries)
      .where(and(inArray(discoveries.status, ACTIVE_STATUSES), or(isNull(discoveries.lastVerifiedAt), lt(discoveries.lastVerifiedAt, cutoff))))
      .orderBy(sql`${discoveries.lastVerifiedAt} asc nulls first`, desc(discoveries.scoreTotal))
      .limit(opts.limit ?? (Number(env.VERIFY_LIMIT) || 250));
    const ctxs = await loadContexts(db, { ids: queue.map((q) => q.id), now });
    let modelCalls = Number(env.AI_MAX_ITEMS_PER_RUN) || 40;

    await pool(ctxs, 5, async (ctx) => {
      try {
        let probe: Probe;
        let docs = '';
        if (ctx.d.kind === 'repository') {
          ({ probe, docs } = await enrichRepository(db, ctx, { env, http: opts.http, now, budget }));
        } else if (ctx.p.canonicalKey.startsWith('hf-')) {
          ({ probe, docs } = await enrichHuggingFace(db, ctx, { http: opts.http, now }));
        } else if (ctx.d.kind === 'paper') {
          probe = { state: 'skipped', via: 'Listed by the arXiv / Hugging Face Papers API' };
          docs = ctx.refs.find((r) => r.description)?.description ?? '';
        } else {
          const host = hostOf(ctx.d.canonicalUrl);
          const publisher = ctx.refs.find((r) => r.source.homepage && hostOf(r.source.homepage) === host && r.source.group !== 'community');
          // A publisher listing its own article in its own feed is proof the article exists.
          probe = publisher
            ? { state: 'skipped', via: `Listed in ${publisher.source.name}'s own feed` }
            : await probeUrl(ctx.d.canonicalUrl, opts.http, opts.resolveHost);
        }

        const input = buildInput(ctx, probe, docs, now);
        const { evidence, executionMode } = runChecks(input);
        const credibility = assessCredibility(input, evidence);
        const status = statusFor(credibility.score, evidence);
        const facts = measuredFacts(ctx, now);
        const pack: EvidencePack = {
          id: ctx.d.id, kind: ctx.d.kind, category: ctx.d.categoryId, claimType: ctx.d.claimType, title: ctx.d.title, canonicalUrl: ctx.d.canonicalUrl,
          facts: [...facts, ...evidence.filter((e) => e.outcome !== 'pass').map((e) => e.detail)],
          sources: [
            { label: 'description', text: plainText(input.description, 1500) },
            ...(docs ? [{ label: 'documentation', text: plainText(docs, 5000) }] : []),
            ...ctx.refs.filter((r) => !r.isPrimary).slice(0, 4).map((r) => ({ label: `${r.source.name} title`, text: r.title })),
          ].filter((s) => s.text),
        };
        // Spend model calls on items that cleared the gate and have not been summarised by a model yet.
        const useModel = provider.name !== 'extractive' && status === 'verified' && ctx.d.editorial?.method !== 'llm' && modelCalls-- > 0;
        const summary = await summarize(useModel ? provider : { ...provider, name: 'extractive' }, pack, {
          kind: ctx.d.kind, category: ctx.d.categoryId as CategoryId, title: ctx.d.title, description: input.description, docs, facts, evidence,
          repoName: ctx.d.kind === 'repository' ? ctx.p.name : undefined,
        }, log);
        if (summary.editorial.method === 'llm') stats.summarisedByModel++;
        stats.guardViolations += summary.guardViolations;
        const keepModelNote = ctx.d.editorial?.method === 'llm' && summary.editorial.method !== 'llm';
        const classification = classifyDiscovery(ctx, input.description, docs);

        await db.transaction(async (tx) => {
          const t = tx as unknown as Db;
          await t.delete(verificationEvidence).where(eq(verificationEvidence.discoveryId, ctx.d.id));
          await t.insert(verificationEvidence).values(evidence.map((e) => ({ discoveryId: ctx.d.id, check: e.check, outcome: e.outcome, detail: e.detail, evidenceUrl: e.url, checkedAt: now })));
          if (credibility.score !== ctx.d.confidence || !ctx.d.lastVerifiedAt) {
            await t.insert(credibilityAssessments).values({ discoveryId: ctx.d.id, assessedAt: now, score: credibility.score, level: credibility.level, factors: credibility.factors });
          }
          await t.update(discoveries).set({
            status, confidence: credibility.score, confidenceLevel: credibility.level, credibilityFactors: credibility.factors,
            executionMode, lastVerifiedAt: now,
            industries: classification.industries, evidenceStage: classification.stage?.stage ?? null, evidenceStageCue: classification.stage?.cue ?? null,
            conceptId: classification.conceptId,
            ...(keepModelNote ? {} : { headline: summary.headline, summary: summary.summary, editorial: summary.editorial }),
            ...(summary.aiSignificance != null ? { aiSignificance: summary.aiSignificance } : {}),
          }).where(eq(discoveries.id, ctx.d.id));
          if (classification.model) {
            const model = { ...classification.model, updatedAt: now };
            await t.insert(modelReleases).values({ discoveryId: ctx.d.id, ...model }).onConflictDoUpdate({ target: modelReleases.discoveryId, set: model });
          }
        });
        stats[status]++;
      } catch (err) {
        stats.errors++;
        log.error('verification failed', { id: ctx.d.id, error: (err as Error).message });
      }
    });

    const status: JobSummary['status'] = stats.errors > 0 || budget.exhausted ? 'degraded' : 'success';
    const all = { ...stats, queued: ctxs.length, durationMs: Date.now() - started };
    await finishRun(db, runId, { status, stats: all, error: budget.exhausted ? 'GitHub rate limit reached; remaining repositories will be checked next run' : null }, new Date());
    log.info('verification finished', { status, ...all, summariser: provider.name });
    return { job: 'verify', status, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats: all, error: null };
  } catch (err) {
    const error = (err as Error).message;
    await finishRun(db, runId, { status: 'failed', stats, error }, new Date());
    log.error('verification run failed', { error });
    return { job: 'verify', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers: [], stats, error };
  }
}
