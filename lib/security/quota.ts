/**
 * Fixed-window counters on `usage_counters`.
 *
 * `consume` is one statement:
 *
 *   INSERT .. ON CONFLICT (key, window_start)
 *   DO UPDATE SET count = usage_counters.count + $n, cost = ..
 *   WHERE usage_counters.count + $n <= $limit
 *   RETURNING count
 *
 * The limit is checked inside the statement rather than after it ("check in
 * the WHERE" rather than "increment then check"). Postgres locks the
 * conflicting row and re-evaluates the WHERE against its latest committed
 * version, so two concurrent callers cannot both take the last slot, and a
 * denied request changes nothing: hammering a limit does not push the counter
 * past it or keep the caller locked out beyond the end of the window.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { usageCounters } from '@/lib/db/schema';

export interface ConsumeInput {
  key: string;
  windowMs: number;
  limit: number;
  /** How much of the limit this request takes. Default 1. */
  amount?: number;
  /** Money for reporting; never compared against anything. */
  cost?: number;
  now: Date;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export function windowStartOf(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Current use of a counter without changing it. */
export async function peek(db: Db, input: { key: string; windowMs: number; limit: number; now: Date }): Promise<{ used: number; cost: number; remaining: number; resetAt: Date }> {
  const windowStart = windowStartOf(input.now, input.windowMs);
  const [row] = await db
    .select({ count: usageCounters.count, cost: usageCounters.cost })
    .from(usageCounters)
    .where(and(eq(usageCounters.key, input.key), eq(usageCounters.windowStart, windowStart)))
    .limit(1);
  const used = row?.count ?? 0;
  return { used, cost: row?.cost ?? 0, remaining: Math.max(0, input.limit - used), resetAt: new Date(windowStart.getTime() + input.windowMs) };
}

/** Takes `amount` from the limit if, and only if, it fits. */
export async function consume(db: Db, input: ConsumeInput): Promise<ConsumeResult> {
  const amount = Math.max(1, Math.ceil(input.amount ?? 1));
  const cost = input.cost ?? 0;
  const windowStart = windowStartOf(input.now, input.windowMs);
  const resetAt = new Date(windowStart.getTime() + input.windowMs);

  // A request larger than the whole limit can never fit; the INSERT branch has no WHERE to stop it.
  if (amount <= input.limit) {
    const rows = await db
      .insert(usageCounters)
      .values({ key: input.key, windowStart, count: amount, cost })
      .onConflictDoUpdate({
        target: [usageCounters.key, usageCounters.windowStart],
        set: { count: sql`${usageCounters.count} + ${amount}`, cost: sql`${usageCounters.cost} + ${cost}` },
        setWhere: sql`${usageCounters.count} + ${amount} <= ${input.limit}`,
      })
      .returning({ count: usageCounters.count });
    if (rows.length) return { allowed: true, remaining: Math.max(0, input.limit - rows[0].count), resetAt };
  }
  const current = await peek(db, input);
  return { allowed: false, remaining: current.remaining, resetAt };
}

/**
 * Moves a counter by a signed amount with no limit check, never below zero.
 * Used to return a reservation that was not spent and to settle the
 * difference between an estimate and the real figure. Pass the `now` of the
 * original `consume` so the same window is adjusted.
 */
export async function adjust(db: Db, input: { key: string; windowMs: number; amount: number; cost?: number; now: Date }): Promise<void> {
  const amount = Math.trunc(input.amount);
  const cost = input.cost ?? 0;
  if (amount === 0 && cost === 0) return;
  await db
    .insert(usageCounters)
    .values({ key: input.key, windowStart: windowStartOf(input.now, input.windowMs), count: Math.max(0, amount), cost: Math.max(0, cost) })
    .onConflictDoUpdate({
      target: [usageCounters.key, usageCounters.windowStart],
      set: { count: sql`greatest(0, ${usageCounters.count} + ${amount})`, cost: sql`greatest(0, ${usageCounters.cost} + ${cost})` },
    });
}

/** Every counter in windows starting at or after `since`. For the operator's usage report. */
export async function listUsage(db: Db, since: Date): Promise<{ key: string; windowStart: Date; count: number; cost: number }[]> {
  return db.select().from(usageCounters).where(gte(usageCounters.windowStart, since)).orderBy(usageCounters.key, usageCounters.windowStart);
}
