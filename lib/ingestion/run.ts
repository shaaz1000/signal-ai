import type { JobSummary, ProviderResult } from '@/lib/types';
import type { Db } from '@/lib/db/client';
import { finishRun, persistGroups, startRun, syncReferenceData } from '@/lib/db/store';
import type { HttpOptions } from '@/lib/utils/http';
import { log as rootLog, type Logger } from '@/lib/utils/log';
import { groupCandidates, normalizeCandidates } from './normalize';
import { ADAPTERS } from './registry';
import { SourceSkipped, type CandidateInput, type SourceAdapter } from './types';

export interface RunOptions {
  now?: Date;
  env?: Record<string, string | undefined>;
  http?: HttpOptions;
  log?: Logger;
  adapters?: SourceAdapter[];
  /** Hard ceiling per source so one hung provider cannot stall the run. */
  sourceTimeoutMs?: number;
  concurrency?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Runs tasks with a concurrency cap. Each task handles its own errors. */
export async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

/**
 * Stages 1 to 3: discover, normalise, deduplicate, persist. Providers are
 * isolated: a failing source is recorded and the rest carry on, and the run is
 * marked `degraded` rather than failed.
 */
export async function runDiscovery(db: Db, opts: RunOptions = {}): Promise<JobSummary> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const log = (opts.log ?? rootLog).child({ job: 'discover' });
  const adapters = opts.adapters ?? ADAPTERS;
  const started = Date.now();

  await syncReferenceData(db, adapters.map((a) => a.meta));
  const runId = await startRun(db, 'discover', now);
  const raw: CandidateInput[] = [];

  const providers = await pool(adapters, opts.concurrency ?? 6, async (adapter): Promise<ProviderResult> => {
    const t0 = Date.now();
    const base = { source: adapter.meta.id, name: adapter.meta.name, group: adapter.meta.group };
    try {
      const items = await withTimeout(
        adapter.fetch({ now, env, http: opts.http ?? {}, log: log.child({ source: adapter.meta.id }) }),
        opts.sourceTimeoutMs ?? 150_000,
        adapter.meta.name,
      );
      raw.push(...items);
      log.info('source ok', { source: adapter.meta.id, fetched: items.length, ms: Date.now() - t0 });
      return { ...base, status: 'ok', fetched: items.length, accepted: 0, durationMs: Date.now() - t0, error: null };
    } catch (err) {
      const skipped = err instanceof SourceSkipped;
      log[skipped ? 'info' : 'warn'](skipped ? 'source skipped' : 'source failed', { source: adapter.meta.id, error: (err as Error).message });
      return { ...base, status: skipped ? 'skipped' : 'failed', fetched: 0, accepted: 0, durationMs: Date.now() - t0, error: (err as Error).message.slice(0, 300) };
    }
  });

  try {
    const normalized = normalizeCandidates(raw, new Map(adapters.map((a) => [a.meta.id, a.meta])));
    for (const p of providers) p.accepted = normalized.items.filter((i) => i.sourceId === p.source).length;
    const groups = groupCandidates(normalized.items);
    const persisted = await persistGroups(db, groups, now, log);

    const attempted = providers.filter((p) => p.status !== 'skipped');
    const failed = attempted.filter((p) => p.status === 'failed').length;
    const status: JobSummary['status'] =
      attempted.length > 0 && failed === attempted.length ? 'failed' : failed > 0 || persisted.failed > 0 ? 'degraded' : 'success';
    const stats = {
      fetched: raw.length, malformed: normalized.malformed, offTopic: normalized.offTopic, unsafeUrls: normalized.unsafe,
      groups: groups.length, ...persisted, sourcesOk: attempted.length - failed, sourcesFailed: failed,
      sourcesSkipped: providers.length - attempted.length, durationMs: Date.now() - started,
    };
    const error = status === 'failed' ? 'Every source failed' : null;
    await finishRun(db, runId, { status, providers, stats, error }, new Date(now.getTime() + (Date.now() - started)));
    log.info('discovery finished', { status, ...stats });
    return { job: 'discover', status, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers, stats, error };
  } catch (err) {
    const error = (err as Error).message;
    await finishRun(db, runId, { status: 'failed', providers, error }, new Date());
    log.error('discovery failed', { error });
    return { job: 'discover', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), providers, stats: {}, error };
  }
}
