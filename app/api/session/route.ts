import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { AUTH_UNAVAILABLE_MESSAGE, authenticateToken, authSecret, clearSessionCookie, createSessionCookie, requestIpHash } from '@/lib/security/auth';
import { MINUTE } from '@/lib/security/config';
import { crossSite, jsonError, jsonOk, readJson } from '@/lib/security/http';
import { consume } from '@/lib/security/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ token: z.string().min(1).max(200) }).strict();

/** Sign-in attempts allowed per address per minute. Tokens are 256 random bits; this stops guessing from being worth trying. */
const ATTEMPTS_PER_MINUTE = 5;

/** POST /api/session { token }: exchanges an access token for a session cookie. */
export async function POST(request: Request) {
  const foreign = crossSite(request);
  if (foreign) return foreign;
  const body = await readJson(request, Body, 1024);
  if (!body.ok) return body.response;
  const env = process.env;
  const ipHash = requestIpHash(request, env);
  if (!authSecret(env) || !ipHash) return jsonError(503, 'auth_unavailable', AUTH_UNAVAILABLE_MESSAGE);

  try {
    const db = await getDb();
    const now = new Date();
    const attempt = await consume(db, { key: `signin:${ipHash}`, windowMs: MINUTE, limit: ATTEMPTS_PER_MINUTE, now });
    if (!attempt.allowed) {
      return jsonError(429, 'rate_limited', 'Too many sign-in attempts. Try again in a minute.', Math.max(1, Math.ceil((attempt.resetAt.getTime() - now.getTime()) / 1000)));
    }
    const user = await authenticateToken(db, body.data.token);
    const cookie = user ? createSessionCookie(user.id, env, now) : null;
    // One answer for an unknown token, a disabled account and a malformed token: nothing to learn from the difference.
    if (!user || !cookie) return jsonError(401, 'unauthenticated', 'That access token is not valid.');
    return jsonOk({ signedIn: true, name: user.name, plan: user.plan }, { 'set-cookie': cookie });
  } catch {
    return jsonError(503, 'unavailable', 'Sign-in is temporarily unavailable.', 30);
  }
}

/** DELETE /api/session: signs out by clearing the cookie. */
export async function DELETE(request: Request) {
  const foreign = crossSite(request);
  if (foreign) return foreign;
  return jsonOk({ signedIn: false }, { 'set-cookie': clearSessionCookie(process.env) });
}
