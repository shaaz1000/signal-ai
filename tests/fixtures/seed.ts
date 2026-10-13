import { count, ne } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { discoveries } from '@/lib/db/schema';
import { runCuration } from '@/lib/curation/run';
import { runDiscovery } from '@/lib/ingestion/run';
import { runRanking } from '@/lib/scoring/run';
import { runVerification } from '@/lib/verification/run';
import { runTrends } from '@/lib/trends/run';
import { createLogger } from '@/lib/utils/log';
import { HOUR } from '@/lib/utils/time';
import { fixtureAdapters, fixtureFetch, fixtureResolver } from './world';

/**
 * Fills an empty database with the fictional fixture world by running the
 * real pipeline against stubbed sources, then marks every record as a
 * fixture. Refuses to run if the database already holds ingested records, so
 * demonstration data can never be mixed into real data.
 */
export async function seedFixtures(db: Db, now: Date): Promise<number> {
  const [{ n: existing }] = await db.select({ n: count() }).from(discoveries).where(ne(discoveries.origin, 'fixture'));
  if (existing > 0) throw new Error(`Refusing to seed fixtures: the database already holds ${existing} ingested discoveries.`);

  const log = createLogger({}, () => undefined);
  const env = { GITHUB_TOKEN: 'fixture-token' };
  const http = { fetchImpl: fixtureFetch(now), sleep: async () => undefined, retries: 0 };
  const earlier = new Date(now.getTime() - 6 * HOUR);

  // Two observations six hours apart, so star growth is computed from snapshots like in production.
  await runDiscovery(db, { now: earlier, env, log, adapters: fixtureAdapters(earlier, 0) });
  await runDiscovery(db, { now, env, log, adapters: fixtureAdapters(now, 1) });
  await runVerification(db, { now, env, log, http, resolveHost: fixtureResolver });
  await runRanking(db, { now, env, log });
  // Two daily trend snapshots, so trend status has a history to compare against.
  await runTrends(db, { now: new Date(now.getTime() - 24 * HOUR), env, log });
  await runTrends(db, { now, env, log });
  await runCuration(db, { now, env, log });

  await db.update(discoveries).set({ origin: 'fixture' });
  const [{ n }] = await db.select({ n: count() }).from(discoveries);
  return n;
}
