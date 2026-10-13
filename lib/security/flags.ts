/** Runtime switches in `app_flags`, and the audit trail for changing them. */
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { appFlags, auditLogs } from '@/lib/db/schema';
import { disabledByEnv, type Env } from './config';

export const KILL_SWITCH = 'generation_disabled';
export const SETTABLE_FLAGS = [KILL_SWITCH] as const;
export type SettableFlag = (typeof SETTABLE_FLAGS)[number];

export async function getFlag(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select({ value: appFlags.value }).from(appFlags).where(eq(appFlags.key, key)).limit(1);
  return row?.value ?? null;
}

/**
 * True when paid work is switched off, by environment or by flag. The flag
 * read is deliberately not caught here: if the switch cannot be read the
 * caller must treat generation as off.
 */
export async function generationDisabled(db: Db, env: Env): Promise<boolean> {
  if (disabledByEnv(env)) return true;
  return (await getFlag(db, KILL_SWITCH)) === true;
}

export async function writeAudit(db: Db, entry: { actor: string; action: string; subject: string; detail?: Record<string, unknown>; now?: Date }): Promise<void> {
  await db.insert(auditLogs).values({ actor: entry.actor, action: entry.action, subject: entry.subject, detail: entry.detail ?? {}, createdAt: entry.now ?? new Date() });
}

/** Sets an operator flag and records who did it. The two writes share a transaction so a change is never unaudited. */
export async function setFlag(db: Db, input: { key: SettableFlag; value: boolean; actor: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(appFlags)
      .values({ key: input.key, value: input.value, updatedAt: now })
      .onConflictDoUpdate({ target: appFlags.key, set: { value: input.value, updatedAt: now } });
    await writeAudit(tx as unknown as Db, { actor: input.actor, action: 'flag:set', subject: input.key, detail: { value: input.value }, now });
  });
}
