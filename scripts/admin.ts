/**
 * Operator CLI for accounts, the kill switch and usage. `tsx scripts/admin.ts <command>`
 *
 *   user:create --name <name> [--plan free|pro] [--role user|admin]
 *   user:disable --id <id>
 *   flag:set generation_disabled true|false
 *   usage
 *
 * `user:create` prints the access token once. Only its hash is stored, so it
 * cannot be shown again; create a new user if it is lost.
 */
import { closeDb, getHandle } from '@/lib/db/client';
import { createUser, disableUser } from '@/lib/security/auth';
import { isPlan } from '@/lib/security/config';
import { setFlag, SETTABLE_FLAGS, writeAudit, type SettableFlag } from '@/lib/security/flags';
import { listUsage } from '@/lib/security/quota';
import { DAY } from '@/lib/utils/time';

const USAGE = 'Usage: admin.ts user:create --name <name> [--plan free|pro] [--role user|admin] | user:disable --id <id> | flag:set generation_disabled true|false | usage';

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !['user:create', 'user:disable', 'flag:set', 'usage'].includes(command)) throw new Error(USAGE);
  const { db } = await getHandle();
  const actor = 'cli';

  if (command === 'user:create') {
    const name = option(args, 'name');
    const plan = option(args, 'plan') ?? 'free';
    const role = option(args, 'role') ?? 'user';
    if (!name || !isPlan(plan) || (role !== 'user' && role !== 'admin')) throw new Error(USAGE);
    const { user, token } = await createUser(db, { name, plan, role });
    await writeAudit(db, { actor, action: 'user:create', subject: `user:${user.id}`, detail: { plan, role } });
    console.log(`Created user ${user.id} (${user.name}, plan ${user.plan}, role ${user.role}).`);
    console.log('Access token (shown once, store it now):');
    console.log(token);
    return;
  }

  if (command === 'user:disable') {
    const id = Number(option(args, 'id'));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(USAGE);
    if (!(await disableUser(db, id))) throw new Error(`No user with id ${id}.`);
    await writeAudit(db, { actor, action: 'user:disable', subject: `user:${id}` });
    console.log(`Disabled user ${id}. Their token and sessions no longer work.`);
    return;
  }

  if (command === 'flag:set') {
    const [key, value] = args;
    if (!(SETTABLE_FLAGS as readonly string[]).includes(key) || (value !== 'true' && value !== 'false')) throw new Error(USAGE);
    await setFlag(db, { key: key as SettableFlag, value: value === 'true', actor });
    console.log(`${key} = ${value}`);
    return;
  }

  // Daily windows start at 00:00 UTC; shorter windows from today are listed too.
  const since = new Date(Math.floor(Date.now() / DAY) * DAY);
  const rows = await listUsage(db, since);
  if (!rows.length) console.log('No usage recorded today.');
  for (const row of rows) console.log(`${row.windowStart.toISOString()}  ${row.key}  count=${row.count}  cost=${row.cost}`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
