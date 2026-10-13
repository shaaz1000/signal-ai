import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type StorageKind = 'postgres' | 'pglite';

interface Handle {
  db: Db;
  kind: StorageKind;
  close: () => Promise<void>;
  /** Present for the embedded store only; used to pack it for the data branch. */
  dump?: () => Promise<Blob>;
}

const MIGRATIONS = path.join(/* turbopackIgnore: true */ process.cwd(), 'drizzle');
const globalRef = globalThis as unknown as { __signalDb?: Promise<Handle> };

async function openPostgres(url: string): Promise<Handle> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  // `prepare: false` keeps this compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 15 });
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    kind: 'postgres',
    close: () => client.end({ timeout: 5 }),
  };
}

export async function openPglite(dataDir?: string, loadDataDir?: Blob): Promise<Handle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir, loadDataDir ? { loadDataDir } : undefined);
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    close: () => client.close(),
    dump: async () => (await client.dumpDataDir('gzip')) as Blob,
  };
}

export async function migratePostgres(url: string): Promise<void> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end({ timeout: 5 });
  }
}

export function pgliteDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.PGLITE_DIR ?? '.data/pglite');
}

/** One connection per process, shared across Next.js hot reloads. */
export function getHandle(): Promise<Handle> {
  if (!globalRef.__signalDb) {
    const url = process.env.DATABASE_URL;
    globalRef.__signalDb = (url ? openPostgres(url) : openPglite(pgliteDir())).catch((err) => {
      globalRef.__signalDb = undefined;
      throw err;
    });
  }
  return globalRef.__signalDb;
}

export async function getDb(): Promise<Db> {
  return (await getHandle()).db;
}

export async function closeDb(): Promise<void> {
  const pending = globalRef.__signalDb;
  globalRef.__signalDb = undefined;
  if (pending) await (await pending).close();
}

/** Fresh in-memory database with the real migrations applied. For tests. */
export async function createTestDb(): Promise<Handle> {
  return openPglite();
}

export { schema };
