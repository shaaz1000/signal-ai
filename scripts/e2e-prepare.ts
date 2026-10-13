/**
 * Prepares a self-contained environment for the end-to-end tests: a fresh
 * embedded database seeded with labelled fixtures, an Artifact built from it,
 * and a production build of the app. No network access is needed.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const env = { ...process.env, PGLITE_DIR: '.data/e2e', DATABASE_URL: '', LOG_SILENT: '1' };
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit', env });

rmSync('.data/e2e', { recursive: true, force: true });
run('npx', ['tsx', 'scripts/run.ts', 'seed-fixtures']);
run('npx', ['tsx', 'scripts/run.ts', 'export', 'dist/e2e/snapshot.json']);
run('npx', ['tsx', 'scripts/build-artifact.ts', '--snapshot', 'dist/e2e/snapshot.json', '--out', 'dist/artifact-e2e']);
if (!process.argv.includes('--skip-build')) run('npx', ['next', 'build']);
