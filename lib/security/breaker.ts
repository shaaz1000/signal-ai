/**
 * Circuit breaker per provider, kept in `app_flags` (`breaker:<provider>`) so
 * every server instance sees the same state.
 *
 *   closed     normal.
 *   open       `threshold` failures in a row. Requests are refused for `openMs`
 *              without calling the provider.
 *   half-open  `openMs` has passed. One request at a time is let through as a
 *              probe: success closes the breaker, failure opens it again.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { appFlags } from '@/lib/db/schema';
import type { Limits } from './config';

export type BreakerConfig = Limits['breaker'];
export type BreakerState = { state: 'closed' } | { state: 'open'; retryAfter: number } | { state: 'half_open' };

interface BreakerValue {
  failures: number;
  /** Epoch milliseconds when the breaker last opened, or null. */
  openedAt: number | null;
  /** Epoch milliseconds when the current half-open probe started, or null. */
  probeAt: number | null;
}

const breakerKey = (provider: string) => `breaker:${provider}`;

export async function breakerState(db: Db, provider: string, now: Date, config: BreakerConfig): Promise<BreakerState> {
  const [row] = await db.select({ value: appFlags.value }).from(appFlags).where(eq(appFlags.key, breakerKey(provider))).limit(1);
  const value = row?.value as Partial<BreakerValue> | undefined;
  if (!value || typeof value.openedAt !== 'number') return { state: 'closed' };
  const elapsed = now.getTime() - value.openedAt;
  if (elapsed < config.openMs) return { state: 'open', retryAfter: Math.max(1, Math.ceil((config.openMs - elapsed) / 1000)) };
  return { state: 'half_open' };
}

/**
 * Claims the single half-open probe. False means another request holds it. A
 * probe that never reported back is released after `probeTimeoutMs`.
 */
export async function claimProbe(db: Db, provider: string, now: Date, probeTimeoutMs: number): Promise<boolean> {
  const nowMs = now.getTime();
  const rows = await db
    .update(appFlags)
    .set({ value: sql`jsonb_set(${appFlags.value}, '{probeAt}', to_jsonb(${nowMs}::bigint))`, updatedAt: now })
    .where(
      and(
        eq(appFlags.key, breakerKey(provider)),
        sql`(${appFlags.value}->>'probeAt' is null or (${appFlags.value}->>'probeAt')::bigint <= ${nowMs - probeTimeoutMs}::bigint)`,
      ),
    )
    .returning({ key: appFlags.key });
  return rows.length > 0;
}

/** Counts one failure, atomically, and opens the breaker at the threshold. */
export async function breakerFailure(db: Db, provider: string, now: Date, config: BreakerConfig): Promise<void> {
  const nowMs = now.getTime();
  const first: BreakerValue = { failures: 1, openedAt: config.threshold <= 1 ? nowMs : null, probeAt: null };
  const failures = sql`coalesce((${appFlags.value}->>'failures')::int, 0) + 1`;
  await db
    .insert(appFlags)
    .values({ key: breakerKey(provider), value: first, updatedAt: now })
    .onConflictDoUpdate({
      target: appFlags.key,
      set: {
        updatedAt: now,
        value: sql`jsonb_build_object(
          'failures', ${failures},
          'openedAt', case when ${failures} >= ${config.threshold}::int then to_jsonb(${nowMs}::bigint) else coalesce(${appFlags.value}->'openedAt', 'null'::jsonb) end,
          'probeAt', 'null'::jsonb
        )`,
      },
    });
}

/** Closes the breaker after a success. Writes only when there is something to clear. */
export async function breakerReset(db: Db, provider: string, now: Date): Promise<void> {
  const closed: BreakerValue = { failures: 0, openedAt: null, probeAt: null };
  await db
    .update(appFlags)
    .set({ value: closed, updatedAt: now })
    .where(and(eq(appFlags.key, breakerKey(provider)), sql`(coalesce((${appFlags.value}->>'failures')::int, 0) > 0 or ${appFlags.value}->>'openedAt' is not null)`));
}
