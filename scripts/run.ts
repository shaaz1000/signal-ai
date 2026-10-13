/**
 * Pipeline CLI. `tsx scripts/run.ts <command>`
 *
 *   migrate | discover | verify | rank | trends | curate | maintain | pipeline
 *   status  | export [path] | seed-fixtures
 *
 * Exit code is 1 only when a job fails outright; a degraded run (some
 * providers down) exits 0 so scheduled workflows keep their data.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getHandle, migratePostgres } from '@/lib/db/client';
import { buildSnapshot, loadStatus } from '@/lib/db/views';
import { runCuration, runMaintenance } from '@/lib/curation/run';
import { runDiscovery } from '@/lib/ingestion/run';
import { runRanking } from '@/lib/scoring/run';
import { runVerification } from '@/lib/verification/run';
import { runTrends } from '@/lib/trends/run';
import { log } from '@/lib/utils/log';
import type { JobSummary } from '@/lib/types';

async function main(): Promise<number> {
  const [command = 'status', arg] = process.argv.slice(2);
  if (command === 'migrate') {
    if (process.env.DATABASE_URL) await migratePostgres(process.env.DATABASE_URL);
    else await getHandle(); // The embedded store migrates itself on open.
    log.info('migrations applied', { storage: process.env.DATABASE_URL ? 'postgres' : 'pglite' });
    return 0;
  }

  const { db, kind } = await getHandle();
  const jobs: Record<string, () => Promise<JobSummary>> = {
    discover: () => runDiscovery(db),
    verify: () => runVerification(db),
    rank: () => runRanking(db),
    curate: () => runCuration(db),
    maintain: () => runMaintenance(db),
    trends: () => runTrends(db),
  };

  if (command === 'pipeline') {
    let failed = false;
    for (const name of ['discover', 'verify', 'rank', 'trends', 'curate']) {
      const result = await jobs[name]();
      failed ||= result.status === 'failed';
      // Verification and ranking still add value on existing data if discovery failed.
    }
    return failed ? 1 : 0;
  }
  if (jobs[command]) return (await jobs[command]()).status === 'failed' ? 1 : 0;

  if (command === 'status') {
    console.log(JSON.stringify(await loadStatus(db, kind, new Date()), null, 2));
    return 0;
  }
  if (command === 'export') {
    const target = path.resolve(arg ?? 'public/data/snapshot.json');
    const { loadTrends } = await import('@/lib/trends/run');
    const snapshot = await buildSnapshot(db, kind, new Date(), 400, { trends: await loadTrends(db, new Date()) });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(snapshot));
    log.info('snapshot exported', { target, discoveries: snapshot.discoveries.length, mode: snapshot.status.dataMode });
    return 0;
  }
  if (command === 'seed-fixtures') {
    const { seedFixtures } = await import('@/tests/fixtures/seed');
    const n = await seedFixtures(db, new Date());
    log.info('fixtures seeded', { discoveries: n });
    return 0;
  }
  console.error(`Unknown command: ${command}`);
  return 2;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    log.error('fatal', { error: (err as Error).stack ?? String(err) });
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
