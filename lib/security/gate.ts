/**
 * The single entry point for paid work. Every model or translation call in
 * the application goes through `runProtected`; nothing else may call a paid
 * provider on behalf of a request.
 *
 * Order of checks (each returns a typed denial):
 *
 *   a  input size                     400 invalid_input / 413 input_too_large
 *   b  cache                          a stored record is returned at once:
 *                                     no sign-in, no quota, no job
 *   c  kill switch                    503 disabled
 *   d  sign-in                        503 auth_unavailable / 401 unauthenticated
 *   e  per-address volume             signal only, never a denial
 *   f  abuse cooldown                 429 cooldown
 *   g  per-kind rate limit            429 rate_limited
 *   h  user / global / provider budget  429 or 503 budget_exhausted
 *   i  circuit breaker                503 provider_unavailable
 *   j  idempotency                    409 in_progress, or the stored result
 *   k  concurrent jobs                429 too_many_concurrent
 *
 * Fail closed: if any query in c to k throws, the answer is 503
 * `quota_unavailable` and the operation is not run.
 *
 * Budgets are reserved before the operation (the estimate is taken from all
 * three budgets atomically, so parallel requests cannot overspend together),
 * then settled to the real figure on success or returned in full on failure.
 * The rate-limit slot taken in g is returned if a later check denies the
 * request, and kept if the provider was actually called.
 *
 * The operation itself runs outside any database transaction, under a hard
 * timeout, with an AbortSignal.
 */
import { createHash } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { generationJobs, users } from '@/lib/db/schema';
import { clientKey } from '@/lib/server/rate-limit';
import { log as rootLog } from '@/lib/utils/log';
import { DAY, HOUR } from '@/lib/utils/time';
import { activeCooldown, recordDenial, recordIpPressure, recordUncached } from './abuse';
import { AUTH_UNAVAILABLE_MESSAGE, authSecret, getCurrentUser, hashIp, type AuthUser } from './auth';
import { breakerFailure, breakerReset, breakerState, claimProbe } from './breaker';
import { limitsFor, type Env, type Limits, type PaidKind } from './config';
import { getContentById } from './content';
import { generationDisabled, writeAudit } from './flags';
import { adjust, consume } from './quota';

const log = rootLog.child({ scope: 'gate' });

export type DenialCode =
  | 'invalid_input' | 'input_too_large' | 'misconfigured' | 'disabled' | 'auth_unavailable' | 'unauthenticated'
  | 'cooldown' | 'rate_limited' | 'budget_exhausted' | 'provider_unavailable' | 'in_progress' | 'too_many_concurrent'
  | 'quota_unavailable' | 'provider_failed' | 'timeout' | 'not_configured';

export interface Denial {
  ok: false;
  status: number;
  code: DenialCode;
  /** Safe to show to the caller. Never contains provider output or internals. */
  message: string;
  /** Seconds. */
  retryAfter?: number;
}

export interface Cached<T> {
  payload: T;
  provider: string;
  model: string;
}

export interface OpResult<T> {
  payload: T;
  provider: string;
  model: string;
  /** Characters sent plus received. */
  units: number;
}

export interface GateSuccess<T> {
  ok: true;
  /** True when no provider was called for this request. */
  cached: boolean;
  payload: T;
  provider: string;
  model: string;
  /** Units charged to this request; 0 when cached. */
  units: number;
}

export type GateResult<T> = GateSuccess<T> | Denial;

export interface GateContext<T> {
  request: Request;
  env: Env;
  now: Date;
  kind: PaidKind;
  /** `discovery:<id>` or `concept:<id>`. */
  subject: string;
  /** Everything else that identifies the result: content version, language, variant, provider, model. */
  cacheKeyParts: string[];
  inputChars: number;
  /** Units to reserve before the call. */
  estimateUnits: number;
  /** The one provider this operation will use. The breaker and provider quota are keyed on it, and a result from any other provider is refused. */
  provider: string;
  fetchCached: () => Promise<Cached<T> | null>;
  /** Stores a successful result and returns its `generated_content` id. */
  save?: (result: OpResult<T>, user: AuthUser) => Promise<number>;
}

/** Thrown by an operation that finds nothing is configured to do the work. Reported as 501, and not counted against the provider. */
export class NotConfiguredError extends Error {
  constructor(message = 'not configured') {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

const deny = (status: number, code: DenialCode, message: string, retryAfter?: number): Denial => ({ ok: false, status, code, message, ...(retryAfter ? { retryAfter } : {}) });

const QUOTA_UNAVAILABLE = () => deny(503, 'quota_unavailable', 'Usage limits cannot be checked right now, so no new generation was started. Try again shortly.', 30);
const secondsUntil = (at: Date, now: Date) => Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));

/** Denials that are the caller's own doing. Only these count towards a cooldown. */
const USER_FAULT = new Set<DenialCode>(['rate_limited', 'budget_exhausted', 'in_progress', 'too_many_concurrent']);
/** A budget denial with this status is the deployment's or the provider's, not the caller's. */
const SHARED_BUDGET_STATUS = 503;

export function idempotencyKey(userId: number, kind: string, subject: string, cacheKeyParts: string[]): string {
  return createHash('sha256').update(JSON.stringify([userId, kind, subject, ...cacheKeyParts])).digest('hex');
}

export const usageKeys = {
  rate: (kind: PaidKind, userId: number) => `rate:${kind}:user:${userId}`,
  userBudget: (userId: number) => `budget:user:${userId}`,
  globalBudget: () => 'budget:global',
  providerBudget: (provider: string) => `budget:provider:${provider}`,
  ip: (ipHash: string) => `ip:${ipHash}`,
};

interface Admitted {
  ok: true;
  user: AuthUser;
  limits: Limits;
  jobId: number;
  reserved: number;
}

type Claim = { status: 'claimed'; jobId: number } | { status: 'in_progress' } | { status: 'too_many' } | { status: 'done'; contentId: number };

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: Record<string, unknown>[] } | null)?.rows) ?? [];
}

/**
 * Steps j and k in one short transaction. The user's row is locked first, so
 * every claim by the same user is serialised: the count of running jobs and
 * the insert that depends on it cannot interleave with another claim. The
 * insert also carries the count in its own WHERE as a second guard.
 */
async function claimJob(
  db: Db,
  input: { userId: number; kind: string; subject: string; key: string; estimate: number; now: Date; maxRunning: number; staleBefore: Date },
): Promise<Claim> {
  return db.transaction(async (tx): Promise<Claim> => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');

    // A job still "running" after the request timeout belongs to a request that died. Close it.
    await tx
      .update(generationJobs)
      .set({ status: 'failed', error: 'abandoned', finishedAt: input.now })
      .where(and(eq(generationJobs.userId, input.userId), eq(generationJobs.status, 'running'), lte(generationJobs.startedAt, input.staleBefore)));

    const [existing] = await tx.select().from(generationJobs).where(eq(generationJobs.idempotencyKey, input.key)).limit(1);
    if (existing?.status === 'running') return { status: 'in_progress' };
    if (existing?.status === 'done' && existing.resultId != null) return { status: 'done', contentId: existing.resultId };

    const nowIso = input.now.toISOString();
    const inserted = rowsOf(
      await tx.execute(sql`
        insert into generation_jobs (user_id, kind, subject, idempotency_key, status, cost_estimate, started_at)
        select ${input.userId}::bigint, ${input.kind}::text, ${input.subject}::text, ${input.key}::text, 'running', ${input.estimate}::real, ${nowIso}::timestamptz
        where (select count(*) from generation_jobs where user_id = ${input.userId}::bigint and status = 'running') < ${input.maxRunning}::int
        on conflict (idempotency_key) do update
          set status = 'running', cost_estimate = excluded.cost_estimate, started_at = excluded.started_at, finished_at = null, error = null, result_id = null
          where generation_jobs.status <> 'running'
        returning id`),
    );
    return inserted.length ? { status: 'claimed', jobId: Number(inserted[0].id) } : { status: 'too_many' };
  });
}

type Admission<T> = Admitted | Denial | GateSuccess<T>;

async function admit<T>(db: Db, ctx: GateContext<T>): Promise<Admission<T>> {
  const { env, now, kind } = ctx;

  // c. Kill switch.
  if (await generationDisabled(db, env)) return deny(503, 'disabled', 'Generation is switched off at the moment. Content that already exists is still available.');

  // d. Identity.
  const secret = authSecret(env);
  if (!secret) return deny(503, 'auth_unavailable', AUTH_UNAVAILABLE_MESSAGE);
  const user = await getCurrentUser(db, ctx.request, env, now);
  if (!user) return deny(401, 'unauthenticated', 'Sign in to generate new content. Content that already exists is available without signing in.');
  const limits = limitsFor(user.plan, env);

  // e. Per-address volume: recorded as a signal for the operator. Addresses are shared and spoofable, so this never denies.
  const ipHash = hashIp(clientKey(ctx.request.headers), secret);
  const ipUse = await consume(db, { key: usageKeys.ip(ipHash), windowMs: HOUR, limit: limits.ipHourlyRequests, now });
  if (!ipUse.allowed) await recordIpPressure(db, { userId: user.id, ipHash, kind, now });

  // f. Cooldown, then the cache-busting pattern this request may complete.
  const key = idempotencyKey(user.id, kind, ctx.subject, ctx.cacheKeyParts);
  const cooling =
    (await activeCooldown(db, user.id, now)) ?? (await recordUncached(db, { userId: user.id, ipHash, kind, requestKey: key, now }, limits.abuse));
  if (cooling) return deny(429, 'cooldown', 'Too many requests in a short time. Generation is paused for your account for a few minutes.', secondsUntil(cooling, now));

  const undo: (() => Promise<void>)[] = [];
  /** Returns everything reserved so far, newest first. Each step runs at most once. */
  const rollback = async (): Promise<void> => {
    for (let step = undo.pop(); step; step = undo.pop()) await step();
  };
  /** Returns what was reserved, records a denial that was the caller's doing, and passes the denial through. */
  const refuse = async (denial: Denial): Promise<Denial> => {
    await rollback();
    if (USER_FAULT.has(denial.code) && denial.status !== SHARED_BUDGET_STATUS) await recordDenial(db, { userId: user.id, ipHash, code: denial.code, kind, now }, limits.abuse);
    return denial;
  };

  try {
    // g. Per-kind rate limit.
    const rate = { key: usageKeys.rate(kind, user.id), windowMs: limits.perKind[kind].windowMs, now };
    const slot = await consume(db, { ...rate, limit: limits.perKind[kind].limit });
    if (!slot.allowed) return await refuse(deny(429, 'rate_limited', `You have reached the limit for new ${kind} requests. Try again later.`, secondsUntil(slot.resetAt, now)));
    undo.push(() => adjust(db, { ...rate, amount: -1 }));

    // h. Budgets: reserve the estimate from the user, the deployment and the provider.
    const reserved = Math.max(1, Math.ceil(Number.isFinite(ctx.estimateUnits) ? ctx.estimateUnits : Number.MAX_SAFE_INTEGER));
    const cost = reserved * limits.unitCost;
    const budgets = [
      { key: usageKeys.userBudget(user.id), limit: limits.userDailyUnits, status: 429, message: 'You have used your generation allowance for today.' },
      { key: usageKeys.globalBudget(), limit: limits.globalDailyUnits, status: 503, message: 'The service has used its generation allowance for today.' },
      { key: usageKeys.providerBudget(ctx.provider), limit: limits.providerDailyUnits, status: 503, message: 'The service has used its generation allowance for today.' },
    ];
    for (const budget of budgets) {
      const taken = await consume(db, { key: budget.key, windowMs: DAY, limit: budget.limit, amount: reserved, cost, now });
      if (!taken.allowed) return await refuse(deny(budget.status, 'budget_exhausted', budget.message, secondsUntil(taken.resetAt, now)));
      undo.push(() => adjust(db, { key: budget.key, windowMs: DAY, amount: -reserved, cost: -cost, now }));
    }

    // i. Circuit breaker.
    const breaker = await breakerState(db, ctx.provider, now, limits.breaker);
    if (breaker.state === 'open') return await refuse(deny(503, 'provider_unavailable', 'The generation provider is having problems. Try again in a minute.', breaker.retryAfter));

    // j, k. Idempotency and the concurrent-job cap.
    const claim = await claimJob(db, {
      userId: user.id, kind, subject: ctx.subject, key, estimate: reserved, now,
      maxRunning: limits.concurrentJobs,
      staleBefore: new Date(now.getTime() - limits.requestTimeoutMs),
    });
    if (claim.status === 'in_progress') return await refuse(deny(409, 'in_progress', 'This exact request is already being worked on. Its result will be available shortly.', 5));
    if (claim.status === 'too_many') return await refuse(deny(429, 'too_many_concurrent', 'You already have the maximum number of generations running. Wait for one to finish.', 5));
    if (claim.status === 'done') {
      const stored = await getContentById<T>(db, claim.contentId);
      await rollback();
      if (stored) return { ok: true, cached: true, payload: stored.payload, provider: stored.provider, model: stored.model, units: 0 };
      // The job points at a record that no longer exists: there is nothing to return and nothing safe to assume.
      return deny(409, 'in_progress', 'This request finished but its result is no longer stored. Try again shortly.', 5);
    }

    // A half-open breaker lets exactly one request through to test the provider.
    if (breaker.state === 'half_open' && !(await claimProbe(db, ctx.provider, now, limits.requestTimeoutMs))) {
      await finishJob(db, claim.jobId, { status: 'failed', error: 'breaker half-open', now });
      return await refuse(deny(503, 'provider_unavailable', 'The generation provider is having problems. Try again in a minute.', 10));
    }
    return { ok: true, user, limits, jobId: claim.jobId, reserved };
  } catch (err) {
    // Give back what this request reserved, as far as the store allows, then fail closed.
    for (let step = undo.pop(); step; step = undo.pop()) await step().catch(() => undefined);
    throw err;
  }
}

async function finishJob(db: Db, jobId: number, input: { status: 'done' | 'failed'; error?: string; resultId?: number | null; now: Date }): Promise<void> {
  await db
    .update(generationJobs)
    .set({ status: input.status, error: input.error?.slice(0, 200) ?? null, resultId: input.resultId ?? null, finishedAt: input.now })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'running')));
}

class TimeoutError extends Error {}

/** Runs the operation under a hard timeout. The signal is aborted when the timer fires. */
async function runWithTimeout<T>(op: (signal: AbortSignal) => Promise<OpResult<T>>, timeoutMs: number): Promise<OpResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, timeoutMs);
  });
  const running = Promise.resolve().then(() => op(controller.signal));
  // If the timer wins, the operation's own late rejection must not go unhandled.
  running.catch(() => undefined);
  try {
    return await Promise.race([running, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort bookkeeping after the provider call. A failure here is logged, not thrown: the call has already happened. */
async function settle(what: string, jobId: number, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    log.error('gate bookkeeping failed', { what, jobId, error: (err as Error).message });
  }
}

async function execute<T>(db: Db, ctx: GateContext<T>, admitted: Admitted, op: (signal: AbortSignal) => Promise<OpResult<T>>): Promise<GateResult<T>> {
  const { user, limits, jobId, reserved } = admitted;
  const { now } = ctx;
  const budgetKeys = [usageKeys.userBudget(user.id), usageKeys.globalBudget(), usageKeys.providerBudget(ctx.provider)];
  const moveBudgets = (units: number) => async () => {
    for (const key of budgetKeys) await adjust(db, { key, windowMs: DAY, amount: units, cost: units * limits.unitCost, now });
  };

  let result: OpResult<T>;
  try {
    result = await runWithTimeout(op, limits.requestTimeoutMs);
    // The provider is fixed before the call. A result from anywhere else means something switched provider behind the gate.
    if (result.provider !== ctx.provider) throw new Error(`provider mismatch: expected ${ctx.provider}`);
  } catch (err) {
    const timedOut = err instanceof TimeoutError;
    const unconfigured = err instanceof NotConfiguredError;
    const reason = timedOut ? 'timeout' : (err as Error)?.message || 'failed';
    log.warn('paid operation failed', { kind: ctx.kind, subject: ctx.subject, provider: ctx.provider, jobId, reason });
    await settle('job', jobId, () => finishJob(db, jobId, { status: 'failed', error: reason, now }));
    // Nothing usable was produced, so nothing is charged.
    await settle('refund', jobId, moveBudgets(-reserved));
    if (unconfigured) return deny(501, 'not_configured', 'Generation is not available on this deployment.');
    await settle('breaker', jobId, () => breakerFailure(db, ctx.provider, now, limits.breaker));
    return timedOut
      ? deny(504, 'timeout', 'The generation provider took too long to answer. Nothing was charged.', 30)
      : deny(502, 'provider_failed', 'The generation provider could not complete this request. Nothing was charged.', 30);
  }

  const units = Math.max(0, Math.ceil(Number.isFinite(result.units) ? result.units : reserved));
  let contentId: number | null = null;
  await settle('budget', jobId, moveBudgets(units - reserved));
  if (ctx.save) {
    const save = ctx.save;
    await settle('save', jobId, async () => {
      contentId = await save(result, user);
    });
  }
  await settle('job', jobId, () => finishJob(db, jobId, { status: 'done', resultId: contentId, now }));
  await settle('audit', jobId, () =>
    writeAudit(db, {
      actor: `user:${user.id}`, action: `generate:${ctx.kind}`, subject: ctx.subject, now,
      detail: { jobId, provider: result.provider, model: result.model, units, contentId },
    }),
  );
  await settle('breaker', jobId, () => breakerReset(db, ctx.provider, now));
  return { ok: true, cached: false, payload: result.payload, provider: result.provider, model: result.model, units };
}

/** Runs a paid operation behind every check above. See the file header for the order and the guarantees. */
export async function runProtected<T>(db: Db, ctx: GateContext<T>, op: (signal: AbortSignal) => Promise<OpResult<T>>): Promise<GateResult<T>> {
  // a. Input size. Uses the limits that apply to everyone, so no identity is needed yet.
  let base: Limits;
  try {
    base = limitsFor(null, ctx.env);
  } catch (err) {
    log.error('limit configuration is invalid', { error: (err as Error).message });
    return deny(503, 'misconfigured', 'Generation is unavailable: the server limit configuration is invalid.');
  }
  if (!Number.isFinite(ctx.inputChars) || ctx.inputChars <= 0) return deny(400, 'invalid_input', 'There is no text to work on.');
  if (ctx.inputChars > base.maxInputChars[ctx.kind]) return deny(413, 'input_too_large', `The text is too long for a ${ctx.kind} request.`);

  // b. Cache first: reading what already exists is free and needs no sign-in.
  try {
    const cached = await ctx.fetchCached();
    if (cached) return { ok: true, cached: true, payload: cached.payload, provider: cached.provider, model: cached.model, units: 0 };
  } catch (err) {
    log.error('cache lookup failed', { kind: ctx.kind, error: (err as Error).message });
    return QUOTA_UNAVAILABLE();
  }

  let admitted: Admission<T>;
  try {
    admitted = await admit(db, ctx);
  } catch (err) {
    log.error('quota state unavailable; denying', { kind: ctx.kind, error: (err as Error).message });
    return QUOTA_UNAVAILABLE();
  }
  if (!('jobId' in admitted)) return admitted;
  return execute(db, ctx, admitted, op);
}
