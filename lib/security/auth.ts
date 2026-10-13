/**
 * Identity for paid work. There is no third-party sign-in, so an operator
 * issues each person an access token (`npm run admin -- user:create`). The
 * token is shown once; only its SHA-256 is stored. A token is exchanged for a
 * signed session cookie, or sent directly as `Authorization: Bearer`.
 *
 * Fail closed: without a usable `AUTH_SECRET` nobody is signed in, by cookie
 * or by bearer token. There is no default secret.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { clientKey } from '@/lib/server/rate-limit';
import { DAY } from '@/lib/utils/time';
import { isPlan, type Env, type Plan } from './config';

export const SESSION_COOKIE = 'signal_session';
export const SESSION_TTL_MS = 7 * DAY;
export const MIN_SECRET_LENGTH = 32;

export const AUTH_UNAVAILABLE_MESSAGE =
  'Sign-in is not available: the server operator must set AUTH_SECRET to a random value of at least 32 characters.';

export type Role = 'user' | 'admin';

export interface AuthUser {
  id: number;
  name: string | null;
  plan: Plan;
  role: Role;
}

/** The signing secret, or null when it is missing or too short to trust. */
export function authSecret(env: Env): string | null {
  const secret = env.AUTH_SECRET ?? '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Salted hash of a client address. Raw addresses are never stored. */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

/** Hashed address of the caller, or null when the secret is unavailable. */
export function requestIpHash(request: Request, env: Env): string | null {
  const secret = authSecret(env);
  return secret ? hashIp(clientKey(request.headers), secret) : null;
}

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return { id: row.id, name: row.name, plan: isPlan(row.plan) ? row.plan : 'free', role: row.role === 'admin' ? 'admin' : 'user' };
}

/** Creates a user and returns the access token. This is the only time the token exists in clear. */
export async function createUser(db: Db, input: { name: string; plan?: Plan; role?: Role }): Promise<{ user: AuthUser; token: string }> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error('A user needs a name.');
  if (input.plan !== undefined && !isPlan(input.plan)) throw new Error(`Unknown plan "${String(input.plan)}".`);
  if (input.role !== undefined && input.role !== 'user' && input.role !== 'admin') throw new Error(`Unknown role "${String(input.role)}".`);
  const token = randomBytes(32).toString('base64url');
  const [row] = await db
    .insert(users)
    .values({ externalId: `token:${randomUUID()}`, name, plan: input.plan ?? 'free', role: input.role ?? 'user', tokenHash: hashToken(token) })
    .returning();
  return { user: toAuthUser(row), token };
}

/** Disables a user: their token and any session stop working at once. */
export async function disableUser(db: Db, id: number, now = new Date()): Promise<boolean> {
  const rows = await db.update(users).set({ disabledAt: now }).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
}

/**
 * Resolves an access token to a user. The comparison is a lookup of the
 * token's hash on a unique index, so its timing does not depend on how much
 * of a guessed token is correct.
 */
export async function authenticateToken(db: Db, token: string): Promise<AuthUser | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const [row] = await db.select().from(users).where(eq(users.tokenHash, hashToken(token))).limit(1);
  if (!row || row.disabledAt) return null;
  return toAuthUser(row);
}

async function loadActiveUser(db: Db, id: number): Promise<AuthUser | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!row || row.disabledAt) return null;
  return toAuthUser(row);
}

function sign(userId: number, expirySeconds: number, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}.${expirySeconds}`).digest('base64url');
}

function cookieAttributes(env: Env): string {
  return `Path=/; HttpOnly; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

/** Session value `userId.expiry.signature`, or null when no secret is configured. */
export function createSessionValue(userId: number, env: Env, now: Date): string | null {
  const secret = authSecret(env);
  if (!secret) return null;
  const expiry = Math.floor((now.getTime() + SESSION_TTL_MS) / 1000);
  return `${userId}.${expiry}.${sign(userId, expiry, secret)}`;
}

/** A `Set-Cookie` header value for a new session, or null when sign-in is unavailable. */
export function createSessionCookie(userId: number, env: Env, now: Date): string | null {
  const value = createSessionValue(userId, env, now);
  if (!value) return null;
  return `${SESSION_COOKIE}=${value}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; ${cookieAttributes(env)}`;
}

export function clearSessionCookie(env: Env): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttributes(env)}`;
}

function cookieValue(input: string): string {
  if (!input.includes('=')) return input.trim();
  for (const part of input.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === SESSION_COOKIE) return part.slice(at + 1).trim();
  }
  return '';
}

/**
 * Verifies a session. Accepts either a whole `Cookie` header or the bare
 * cookie value. Returns null for anything missing, malformed, tampered with,
 * expired, or when no secret is configured.
 */
export function readSession(cookieHeaderOrValue: string | null | undefined, env: Env, now: Date): { userId: number; expiresAt: Date } | null {
  const secret = authSecret(env);
  if (!secret || !cookieHeaderOrValue) return null;
  const match = /^(\d{1,15})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(cookieValue(cookieHeaderOrValue));
  if (!match) return null;
  const userId = Number(match[1]);
  const expiry = Number(match[2]);
  const expected = Buffer.from(sign(userId, expiry, secret));
  const given = Buffer.from(match[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (expiry * 1000 <= now.getTime()) return null;
  return { userId, expiresAt: new Date(expiry * 1000) };
}

/**
 * The signed-in, enabled user making this request, or null. A bearer token
 * wins over a cookie; a bearer token that does not resolve is a failed
 * sign-in, not a reason to try the cookie.
 */
export async function getCurrentUser(db: Db, request: Request, env: Env, now = new Date()): Promise<AuthUser | null> {
  if (!authSecret(env)) return null;
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (bearer) return authenticateToken(db, bearer[1]);
  const session = readSession(request.headers.get('cookie'), env, now);
  if (!session) return null;
  return loadActiveUser(db, session.userId);
}
