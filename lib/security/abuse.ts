/**
 * Abuse detection for signed-in users. Two patterns earn a cooldown:
 *
 *  - many denials in a short time (a client retrying against its limits), and
 *  - many distinct uncached requests in a very short time (cache-busting, or
 *    asking for regeneration with ever-changing variants).
 *
 * A cooldown is temporary and belongs to one user. Nothing here blocks
 * permanently, and nothing blocks on an address alone: an address is recorded
 * only as a salted hash, as a signal for an operator to read.
 *
 * The cooldown is a row in `app_flags` (`cooldown:user:<id>`) holding its end
 * time. Events from before a cooldown ended are not counted again, so a
 * cooldown cannot re-trigger itself the moment it expires.
 */
import { and, count, eq, gt, like, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { abuseEvents, appFlags } from '@/lib/db/schema';
import type { Limits } from './config';

export type AbuseConfig = Limits['abuse'];

const UNCACHED = 'uncached';
const DENIED_PREFIX = 'denied:';
const cooldownKey = (userId: number) => `cooldown:user:${userId}`;

interface CooldownValue {
  until: number;
  reason: string;
}

async function readCooldown(db: Db, userId: number): Promise<CooldownValue | null> {
  const [row] = await db.select({ value: appFlags.value }).from(appFlags).where(eq(appFlags.key, cooldownKey(userId))).limit(1);
  const value = row?.value as Partial<CooldownValue> | undefined;
  return value && typeof value.until === 'number' ? { until: value.until, reason: String(value.reason ?? '') } : null;
}

/** End of the user's cooldown if one is running now, else null. */
export async function activeCooldown(db: Db, userId: number, now: Date): Promise<Date | null> {
  const cooldown = await readCooldown(db, userId);
  return cooldown && cooldown.until > now.getTime() ? new Date(cooldown.until) : null;
}

async function startCooldown(db: Db, userId: number, reason: string, now: Date, config: AbuseConfig): Promise<Date> {
  const until = now.getTime() + config.cooldownMs;
  const value: CooldownValue = { until, reason };
  await db.insert(appFlags).values({ key: cooldownKey(userId), value, updatedAt: now }).onConflictDoUpdate({ target: appFlags.key, set: { value, updatedAt: now } });
  await db.insert(abuseEvents).values({ userId, kind: 'cooldown', detail: { reason, until: new Date(until).toISOString() }, createdAt: now });
  return new Date(until);
}

/** Events are counted from the start of the window or the end of the last cooldown, whichever is later. */
async function countFrom(db: Db, userId: number, windowMs: number, now: Date): Promise<Date> {
  const previous = await readCooldown(db, userId);
  return new Date(Math.max(now.getTime() - windowMs, previous?.until ?? 0));
}

/**
 * Records a request that missed the cache. Returns the end of a cooldown if
 * this request completes the cache-busting pattern, else null.
 */
export async function recordUncached(
  db: Db,
  input: { userId: number; ipHash: string | null; kind: string; requestKey: string; now: Date },
  config: AbuseConfig,
): Promise<Date | null> {
  await db.insert(abuseEvents).values({ userId: input.userId, ipHash: input.ipHash, kind: UNCACHED, detail: { kind: input.kind, key: input.requestKey }, createdAt: input.now });
  const since = await countFrom(db, input.userId, config.distinctWindowMs, input.now);
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${abuseEvents.detail}->>'key')`.mapWith(Number) })
    .from(abuseEvents)
    .where(and(eq(abuseEvents.userId, input.userId), eq(abuseEvents.kind, UNCACHED), gt(abuseEvents.createdAt, since)));
  if ((row?.n ?? 0) < config.distinctUncached) return null;
  return startCooldown(db, input.userId, 'distinct_uncached', input.now, config);
}

/**
 * Records a denial. Returns the end of a cooldown if the user has now been
 * denied often enough to earn one, else null.
 */
export async function recordDenial(
  db: Db,
  input: { userId: number; ipHash: string | null; code: string; kind: string; now: Date },
  config: AbuseConfig,
): Promise<Date | null> {
  await db.insert(abuseEvents).values({ userId: input.userId, ipHash: input.ipHash, kind: `${DENIED_PREFIX}${input.code}`, detail: { kind: input.kind }, createdAt: input.now });
  const since = await countFrom(db, input.userId, config.denialWindowMs, input.now);
  const [row] = await db
    .select({ n: count() })
    .from(abuseEvents)
    .where(and(eq(abuseEvents.userId, input.userId), like(abuseEvents.kind, `${DENIED_PREFIX}%`), gt(abuseEvents.createdAt, since)));
  if ((row?.n ?? 0) < config.denials) return null;
  return startCooldown(db, input.userId, 'repeated_denials', input.now, config);
}

/** Notes heavy volume from one address. A signal only: it never denies anything. */
export async function recordIpPressure(db: Db, input: { userId: number | null; ipHash: string; kind: string; now: Date }): Promise<void> {
  await db.insert(abuseEvents).values({ userId: input.userId, ipHash: input.ipHash, kind: 'ip_volume', detail: { kind: input.kind }, createdAt: input.now });
}
