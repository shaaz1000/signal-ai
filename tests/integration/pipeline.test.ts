import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@/lib/db/client';
import { discoveries, ingestionRuns, rankingSnapshots, repoMetricSnapshots, sourceReferences, verificationEvidence } from '@/lib/db/schema';
import { lastRun } from '@/lib/db/store';
import { buildSnapshot, loadStatus, loadViews } from '@/lib/db/views';
import { runCuration, runMaintenance } from '@/lib/curation/run';
import { runDiscovery } from '@/lib/ingestion/run';
import { SourceSkipped, type CandidateInput } from '@/lib/ingestion/types';
import { runRanking } from '@/lib/scoring/run';
import { runVerification } from '@/lib/verification/run';
import { createLogger } from '@/lib/utils/log';
import { DAY, HOUR } from '@/lib/utils/time';
import { stableId } from '@/lib/utils/url';
import { seedFixtures } from '../fixtures/seed';
import { candidates, fixtureAdapters, fixtureFetch, fixtureResolver } from '../fixtures/world';

const NOW = new Date('2026-10-13T09:30:00Z');
const EARLIER = new Date(NOW.getTime() - 6 * HOUR);
const log = createLogger({}, () => undefined);
const env = { GITHUB_TOKEN: 'fixture-token' };
const idOf = (owner: string, name: string) => stableId(`github:${owner}/${name}`.toLowerCase());

let db: Db;
let close: () => Promise<void>;
const rows = async (table: Parameters<Db['select']>[0] extends never ? never : typeof discoveries | typeof sourceReferences | typeof repoMetricSnapshots | typeof rankingSnapshots | typeof ingestionRuns | typeof verificationEvidence) =>
  (await db.select({ n: count() }).from(table))[0].n;

const discover = (now = NOW, phase: 0 | 1 = 1, overrides: Record<string, () => Promise<CandidateInput[]>> = {}) =>
  runDiscovery(db, { now, env, log, adapters: fixtureAdapters(now, phase, overrides) });
const verify = (opts: { rateLimitGithub?: boolean; calls?: string[] } = {}, now = NOW) =>
  runVerification(db, { now, env, log, http: { fetchImpl: fixtureFetch(now, opts), sleep: async () => undefined, retries: 0 }, resolveHost: fixtureResolver });
const view = async (id: string) => (await loadViews(db, NOW, { ids: [id] }))[0];

beforeEach(async () => {
  const handle = await createTestDb();
  db = handle.db;
  close = handle.close;
});
afterEach(() => close());

describe('discovery ingestion', () => {
  it('ingests every healthy source and records what each one returned', async () => {
    const run = await discover();
    expect(run.status).toBe('success');
    expect(run.providers.map((p) => p.status)).toEqual(run.providers.map(() => 'ok'));
    expect(run.providers.find((p) => p.source === 'github')?.fetched).toBe(8);
    expect(await rows(discoveries)).toBeGreaterThanOrEqual(12);
    expect(await rows(repoMetricSnapshots)).toBe(8);
  });

  it('counts malformed, unsafe and off-topic items instead of failing', async () => {
    const run = await discover();
    expect(run.stats.malformed).toBe(1); // the TechCrunch item with no title
    expect(run.stats.unsafeUrls).toBe(1); // the cloud metadata address
    expect(run.stats.offTopic).toBe(1); // the gardening post
    const stored = await db.select({ url: discoveries.canonicalUrl }).from(discoveries);
    expect(stored.some((r) => r.url.includes('169.254'))).toBe(false);
    expect(stored.some((r) => r.url.includes('gardening'))).toBe(false);
  });

  it('collapses the same repository seen on GitHub, Hacker News and Lobsters into one discovery', async () => {
    await discover();
    const refs = await db.select().from(sourceReferences).where(eq(sourceReferences.discoveryId, idOf('fixture-labs', 'page-tracer')));
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['github', 'hackernews', 'lobsters']);
    expect(refs.filter((r) => r.isPrimary).map((r) => r.sourceId)).toEqual(['github']);
  });

  it('merges two outlets reporting one event and keeps both links', async () => {
    await discover();
    const articles = await db.select().from(discoveries).where(eq(discoveries.kind, 'article'));
    expect(articles).toHaveLength(1);
    const refs = await db.select().from(sourceReferences).where(eq(sourceReferences.discoveryId, articles[0].id));
    expect(refs.map((r) => r.sourceId).sort()).toEqual(['arstechnica', 'techcrunch']);
  });

  it('is idempotent: rerunning the same input creates nothing new', async () => {
    await discover();
    const before = { d: await rows(discoveries), r: await rows(sourceReferences), s: await rows(repoMetricSnapshots) };
    const second = await discover();
    expect(second.stats.created).toBe(0);
    expect({ d: await rows(discoveries), r: await rows(sourceReferences), s: await rows(repoMetricSnapshots) }).toEqual(before);
  });

  it('keeps publication time and discovery time separate', async () => {
    await discover();
    const [row] = await db.select().from(discoveries).where(eq(discoveries.id, idOf('fixture-labs', 'page-tracer')));
    expect(row.firstDiscoveredAt.toISOString()).toBe(NOW.toISOString());
    expect(row.publishedAt?.toISOString()).toBe(new Date(NOW.getTime() - 4 * DAY).toISOString());
  });

  it('continues with healthy sources when one fails and marks the run degraded', async () => {
    const run = await discover(NOW, 1, { hackernews: async () => { throw new Error('HTTP 503 from hn.algolia.com'); } });
    expect(run.status).toBe('degraded');
    expect(run.providers.find((p) => p.source === 'hackernews')).toMatchObject({ status: 'failed', error: 'HTTP 503 from hn.algolia.com' });
    expect(await rows(discoveries)).toBeGreaterThanOrEqual(10);
    expect((await lastRun(db, 'discover'))?.status).toBe('degraded');
  });

  it('treats an unconfigured source as skipped, not failed', async () => {
    const run = await discover(NOW, 1, { lobsters: async () => { throw new SourceSkipped('credentials are not configured'); } });
    expect(run.status).toBe('success');
    expect(run.providers.find((p) => p.source === 'lobsters')?.status).toBe('skipped');
  });

  it('fails the run only when every source fails, and writes nothing', async () => {
    const boom = async () => { throw new Error('unavailable'); };
    const all = Object.fromEntries(Object.keys(candidates(NOW, 1)).map((k) => [k, boom]));
    const run = await discover(NOW, 1, all);
    expect(run.status).toBe('failed');
    expect(await rows(discoveries)).toBe(0);
    expect(await lastRun(db, 'discover')).toBeNull(); // only successful runs count as "last ingestion"
  });

  it('gives up on a source that hangs instead of stalling the run', async () => {
    const run = await runDiscovery(db, {
      now: NOW, env, log, sourceTimeoutMs: 40,
      adapters: fixtureAdapters(NOW, 1, { arxiv: () => new Promise(() => undefined) }),
    });
    expect(run.status).toBe('degraded');
    expect(run.providers.find((p) => p.source === 'arxiv')?.error).toMatch(/exceeded/);
  });

  it('attaches later coverage of a stored story to the existing discovery', async () => {
    await discover(NOW, 1, { techcrunch: async () => [] });
    const later = new Date(NOW.getTime() + 3 * HOUR);
    const run = await runDiscovery(db, { now: later, env, log, adapters: fixtureAdapters(later, 1, { arstechnica: async () => [] }) });
    expect(run.stats.attached).toBe(1);
    expect((await db.select().from(discoveries).where(eq(discoveries.kind, 'article')))).toHaveLength(1);
  });
});

describe('verification', () => {
  beforeEach(async () => {
    await discover(EARLIER, 0);
    await discover(NOW, 1);
  });

  it('computes star growth only from recorded snapshots', async () => {
    await verify();
    const d = await view(idOf('fixture-labs', 'page-tracer'));
    expect(d.repo?.growth).toMatchObject({ observedDelta: 380, observedHours: 6, snapshots: 2 });
    expect(d.repo?.stars).toBe(3480);
  });

  it('rejects a repository whose primary source returns 404', async () => {
    const run = await verify();
    expect(run.stats.rejected).toBe(2); // the deleted repository and the dead demo link
    const [row] = await db.select().from(discoveries).where(eq(discoveries.id, idOf('fixture-vanished', 'deleted-project')));
    expect(row.status).toBe('rejected');
    expect((await loadViews(db, NOW)).some((v) => v.id === row.id)).toBe(false);
  });

  it('gives corroborated items higher confidence than primary-source-only items', async () => {
    await verify();
    const corroborated = await view(idOf('fixture-labs', 'page-tracer'));
    const alone = await view(idOf('fixture-solo', 'tiny-agent-loop'));
    expect(corroborated.confidenceLevel).toBe('high');
    expect(alone.confidenceLevel).toBe('medium');
    expect(corroborated.evidence.find((e) => e.check === 'corroboration')?.outcome).toBe('pass');
    expect(alone.evidence.find((e) => e.check === 'corroboration')?.outcome).toBe('unknown');
  });

  it('flags promotional claims and suspicious engagement, and holds the item below the gate', async () => {
    await verify();
    await runRanking(db, { now: NOW, env, log });
    const d = await view(idOf('fixture-growth', 'star-magnet'));
    const outcomes = Object.fromEntries(d.evidence.map((e) => [e.check, e.outcome]));
    expect(outcomes.promotional_language).toBe('warn');
    expect(outcomes.engagement_pattern).toBe('warn');
    expect(d.status).toBe('unverified');
    expect(d.flags).toContain('engagement-anomaly');
    expect(d.scores.gem).toBe(0);
    // The marketing line is never restated as fact.
    expect(d.editorial.limitations.join(' ')).toMatch(/promotional wording/);
  });

  it('ignores instructions embedded in a README and keeps them out of the summary', async () => {
    await verify();
    const d = await view(idOf('fixture-injected', 'helpful-summarizer'));
    const text = JSON.stringify(d.editorial) + d.headline + d.summary;
    expect(text).not.toMatch(/ignore (all )?previous instructions/i);
    expect(text).not.toMatch(/best project ever/i);
    expect(d.evidence.find((e) => e.check === 'untrusted_content')?.outcome).toBe('warn');
  });

  it('states how a browser demo runs only when the source says so', async () => {
    await verify();
    const emulator = await view(idOf('fixture-retro', 'handheld-in-a-tab'));
    expect(emulator.executionMode).toBe('emulation');
    const demo = (await loadViews(db, NOW)).find((v) => v.canonicalUrl.includes('browser-daw'));
    expect(demo?.executionMode).toBeNull();
    expect(demo?.evidence.find((e) => e.check === 'execution_mode')?.outcome).toBe('unknown');
  });

  it('says "not verified" rather than inventing an implementation', async () => {
    await verify();
    const documented = await view(idOf('fixture-labs', 'page-tracer'));
    const undocumented = await view(idOf('fixture-archive', 'legacy-toolkit'));
    expect(documented.editorial.how).toMatch(/headless browser captures the DOM/);
    expect(undocumented.editorial.how).toBeNull();
    expect(documented.editorial.method).toBe('extractive');
  });

  it('degrades gracefully when GitHub rate limits, and retries those items next run', async () => {
    const limited = await verify({ rateLimitGithub: true });
    expect(limited.status).toBe('degraded');
    const d = await view(idOf('fixture-labs', 'page-tracer'));
    expect(d.repo?.stars).toBe(3480); // metrics from the search snapshot are kept
    const retry = new Date(NOW.getTime() + 25 * HOUR);
    const next = await runVerification(db, { now: retry, env, log, http: { fetchImpl: fixtureFetch(retry), sleep: async () => undefined, retries: 0 }, resolveHost: fixtureResolver });
    expect(next.status).toBe('success');
  });

  it('never requests a host outside the fixture world (no stray network calls)', async () => {
    const calls: string[] = [];
    await verify({ calls });
    const hosts = new Set(calls.map((c) => new URL(c).hostname));
    expect([...hosts].sort()).toEqual(['api.github.com', 'demo.example.com', 'gone.example.com', 'huggingface.co']);
  });

  it('labels research claims by type and keeps a preprint out of "high" on its own', async () => {
    await verify();
    const views = await loadViews(db, NOW);
    const corroborated = views.find((v) => v.canonicalUrl.endsWith('2610.01234'));
    const alone = views.find((v) => v.canonicalUrl.endsWith('2610.05678'));
    expect(corroborated?.claimType).toBe('preprint');
    expect(corroborated?.sources.map((s) => s.sourceId).sort()).toEqual(['arxiv', 'hf-papers']);
    expect(corroborated?.evidence.find((e) => e.check === 'review_status')?.outcome).toBe('unknown');
    expect(alone?.confidenceLevel).not.toBe('high');
    expect(corroborated!.confidence).toBeGreaterThan(alone!.confidence);
  });
});

describe('ranking, curation and maintenance', () => {
  beforeEach(async () => {
    await discover(EARLIER, 0);
    await discover(NOW, 1);
    await verify();
  });

  it('ranks a fast-growing new repository above a famous inactive one', async () => {
    await runRanking(db, { now: NOW, env, log });
    const rising = await view(idOf('fixture-labs', 'page-tracer'));
    const famous = await view(idOf('fixture-archive', 'legacy-toolkit'));
    expect(famous.repo!.stars!).toBeGreaterThan(rising.repo!.stars! * 10);
    expect(rising.scores.total).toBeGreaterThan(famous.scores.total);
    expect(famous.scores.momentum).toBeLessThan(15);
    expect(rising.reasons[0]).toMatch(/\+380 stars across 6 h of our own snapshots/);
  });

  it('surfaces a low-star project as a hidden gem and never a high-star one', async () => {
    await runRanking(db, { now: NOW, env, log });
    expect((await view(idOf('fixture-solo', 'tiny-agent-loop'))).scores.gem).toBeGreaterThan(50);
    expect((await view(idOf('fixture-archive', 'legacy-toolkit'))).scores.gem).toBe(0);
    expect((await view(idOf('fixture-labs', 'page-tracer'))).scores.gem).toBe(0);
  });

  it('writes one ranking snapshot per discovery per day however often it runs', async () => {
    await runRanking(db, { now: NOW, env, log });
    const first = await rows(rankingSnapshots);
    await runRanking(db, { now: new Date(NOW.getTime() + HOUR), env, log });
    expect(await rows(rankingSnapshots)).toBe(first);
    await runRanking(db, { now: new Date(NOW.getTime() + DAY), env, log });
    expect(await rows(rankingSnapshots)).toBe(first * 2);
  });

  it('curates a featured story and a weekly edition from verified records only', async () => {
    await runRanking(db, { now: NOW, env, log });
    const run = await runCuration(db, { now: NOW, env, log });
    expect(run.status).toBe('success');
    const snapshot = await buildSnapshot(db, 'pglite', NOW);
    const byId = new Map(snapshot.discoveries.map((d) => [d.id, d]));
    expect(byId.get(snapshot.featuredId!)?.status).toBe('verified');
    const weeklyIds = snapshot.weekly!.sections.flatMap((s) => s.ids);
    expect(weeklyIds.length).toBeGreaterThan(3);
    expect(weeklyIds.every((id) => byId.get(id)?.status === 'verified')).toBe(true);
    expect(weeklyIds).not.toContain(idOf('fixture-growth', 'star-magnet'));
  });

  it('reports freshness truthfully: stale after two missed runs', async () => {
    const fresh = await loadStatus(db, 'pglite', new Date(NOW.getTime() + HOUR));
    expect(fresh.stale).toBe(false);
    expect(fresh.dataMode).toBe('ingested');
    expect(fresh.nextScheduledIngestion).toBe('2026-10-13T12:17:00.000Z');
    const stale = await loadStatus(db, 'pglite', new Date(NOW.getTime() + 9 * HOUR));
    expect(stale.stale).toBe(true);
  });

  it('thins old snapshots, archives dormant items and purges rejected ones', async () => {
    await runRanking(db, { now: NOW, env, log });
    const future = new Date(NOW.getTime() + 60 * DAY);
    const before = await rows(repoMetricSnapshots);
    const run = await runMaintenance(db, { now: future, env, log });
    expect(run.status).toBe('success');
    expect(run.stats.thinnedSnapshots).toBeGreaterThan(0);
    expect(await rows(repoMetricSnapshots)).toBeLessThan(before);
    expect(run.stats.purged).toBe(2);
    expect(run.stats.archived).toBeGreaterThan(0);
    // Safe to rerun.
    const again = await runMaintenance(db, { now: future, env, log });
    expect(again.stats).toMatchObject({ thinnedSnapshots: 0, purged: 0, archived: 0 });
  });

  it('closes a run that was killed mid-flight so status does not show it running forever', async () => {
    await db.insert(ingestionRuns).values({ job: 'discover', status: 'running', startedAt: new Date(NOW.getTime() - 3 * HOUR) });
    await discover(new Date(NOW.getTime() + HOUR));
    const stuck = await db.select().from(ingestionRuns).where(eq(ingestionRuns.status, 'running'));
    expect(stuck).toHaveLength(0);
  });
});

describe('fixture seeding', () => {
  it('marks every seeded record as a fixture and reports fixture mode', async () => {
    const n = await seedFixtures(db, NOW);
    expect(n).toBeGreaterThan(10);
    const status = await loadStatus(db, 'pglite', NOW);
    expect(status.dataMode).toBe('fixture');
    expect((await loadViews(db, NOW)).every((v) => v.fixture)).toBe(true);
  });

  it('refuses to seed over ingested data', async () => {
    await discover();
    await expect(seedFixtures(db, NOW)).rejects.toThrow(/already holds/);
  });
});
