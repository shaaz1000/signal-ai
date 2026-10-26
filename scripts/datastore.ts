/**
 * Packs and unpacks the embedded PGlite store, for the zero-infrastructure
 * mode where GitHub Actions keeps the database on a `data` branch instead of
 * in a hosted Postgres.
 *
 *   tsx scripts/datastore.ts pack <file.tar.gz>
 *   tsx scripts/datastore.ts unpack <file.tar.gz>
 */
import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { openPglite, pgliteDir } from '@/lib/db/client';

async function main() {
  const [command, file] = process.argv.slice(2);
  if (!file || (command !== 'pack' && command !== 'unpack')) throw new Error('Usage: datastore.ts pack|unpack <file.tar.gz>');
  if (process.env.DATABASE_URL) throw new Error('DATABASE_URL is set: the embedded store is not in use, nothing to pack or unpack.');
  const dir = pgliteDir();

  if (command === 'pack') {
    const handle = await openPglite(dir);
    await handle.compact!();
    const blob = await handle.dump!();
    await handle.close();
    await writeFile(file, Buffer.from(await blob.arrayBuffer()));
    console.log(`Packed ${dir} into ${file} (${Math.round(blob.size / 1024)} KB)`);
    return;
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty; refusing to overwrite an existing store.`);
  const handle = await openPglite(dir, new Blob([await readFile(file)]));
  await handle.close();
  console.log(`Unpacked ${file} into ${dir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
