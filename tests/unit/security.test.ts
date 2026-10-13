import { describe, expect, it } from 'vitest';
import {
  authSecret, clearSessionCookie, createSessionCookie, createSessionValue, hashIp, hashToken, readSession, SESSION_COOKIE, SESSION_TTL_MS,
} from '@/lib/security/auth';
import { ConfigError, disabledByEnv, generationProvider, limitsFor } from '@/lib/security/config';
import { idempotencyKey } from '@/lib/security/gate';
import { crossSite, readJson } from '@/lib/security/http';
import { windowStartOf } from '@/lib/security/quota';
import { DAY, HOUR } from '@/lib/utils/time';
import { z } from 'zod';

const SECRET = 'unit-test-secret-that-is-long-enough-0123456789';
const env = { AUTH_SECRET: SECRET };
const now = new Date('2026-10-13T10:00:00Z');

describe('limits', () => {
  it('has the documented defaults for the free plan', () => {
    const limits = limitsFor('free', {});
    expect(limits.perKind).toEqual({
      translation: { limit: 10, windowMs: HOUR },
      explanation: { limit: 5, windowMs: HOUR },
      story: { limit: 3, windowMs: DAY },
      draft: { limit: 10, windowMs: DAY },
    });
    expect(limits.concurrentJobs).toBe(2);
    expect(limits.breaker).toEqual({ threshold: 5, openMs: 60_000 });
    expect(limits.abuse).toMatchObject({ denials: 20, distinctUncached: 8, cooldownMs: 15 * 60_000 });
  });

  it('gives the pro plan higher limits and an unknown plan the free ones', () => {
    const free = limitsFor('free', {});
    const pro = limitsFor('pro', {});
    for (const kind of ['translation', 'explanation', 'story', 'draft'] as const) expect(pro.perKind[kind].limit).toBeGreaterThan(free.perKind[kind].limit);
    expect(pro.userDailyUnits).toBeGreaterThan(free.userDailyUnits);
    expect(limitsFor('enterprise', {})).toEqual(free);
    expect(limitsFor(null, {})).toEqual(free);
  });

  it('reads overrides from the environment per plan', () => {
    const limits = limitsFor('free', { LIMIT_FREE_TRANSLATION_PER_HOUR: '3', LIMIT_PRO_TRANSLATION_PER_HOUR: '30', GENERATION_TIMEOUT_MS: '2000', GENERATION_UNIT_COST: '0.0005' });
    expect(limits.perKind.translation.limit).toBe(3);
    expect(limits.requestTimeoutMs).toBe(2000);
    expect(limits.unitCost).toBe(0.0005);
    expect(limitsFor('pro', { LIMIT_PRO_TRANSLATION_PER_HOUR: '30' }).perKind.translation.limit).toBe(30);
  });

  it('refuses an invalid override instead of falling back to a looser default', () => {
    for (const bad of ['abc', '-1', '1.5', '1e9', '99999999999999999999']) {
      expect(() => limitsFor('free', { LIMIT_FREE_STORY_PER_DAY: bad })).toThrow(ConfigError);
    }
    expect(() => limitsFor('free', { GENERATION_TIMEOUT_MS: '5' })).toThrow(/GENERATION_TIMEOUT_MS/);
    expect(() => limitsFor('free', { GENERATION_UNIT_COST: 'cheap' })).toThrow(ConfigError);
  });

  it('names the variable but never its value in a configuration error', () => {
    try {
      limitsFor('free', { LIMIT_FREE_DAILY_UNITS: 'sk-pasted-secret' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('LIMIT_FREE_DAILY_UNITS');
      expect((err as Error).message).not.toContain('sk-pasted-secret');
    }
  });

  it('re-parses when the same environment object is changed in place', () => {
    const live: Record<string, string> = {};
    expect(limitsFor('free', live).perKind.draft.limit).toBe(10);
    live.LIMIT_FREE_DRAFT_PER_DAY = '4';
    expect(limitsFor('free', live).perKind.draft.limit).toBe(4);
  });

  it('reads the kill switch and the generation provider from the environment', () => {
    expect(disabledByEnv({})).toBe(false);
    expect(disabledByEnv({ GENERATION_DISABLED: 'false' })).toBe(false);
    expect(disabledByEnv({ GENERATION_DISABLED: 'true' })).toBe(true);
    expect(disabledByEnv({ GENERATION_DISABLED: ' TRUE ' })).toBe(true);
    expect(generationProvider({})).toBeNull();
    expect(generationProvider({ AI_PROVIDER: 'anthropic' })).toBeNull();
    expect(generationProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).toBe('anthropic');
    expect(generationProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).toBeNull();
    expect(generationProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' })).toBe('openai');
  });
});

describe('session cookies', () => {
  it('round-trips a signed session and sets the cookie attributes', () => {
    const cookie = createSessionCookie(42, env, now)!;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=42\\.\\d+\\.[A-Za-z0-9_-]{43}; `));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    expect(createSessionCookie(42, { ...env, NODE_ENV: 'production' }, now)).toContain('; Secure');

    const value = createSessionValue(42, env, now)!;
    expect(readSession(value, env, now)).toEqual({ userId: 42, expiresAt: new Date(Math.floor((now.getTime() + SESSION_TTL_MS) / 1000) * 1000) });
    // A whole Cookie header works too, among other cookies.
    expect(readSession(`theme=dark; ${SESSION_COOKIE}=${value}; other=1`, env, now)?.userId).toBe(42);
  });

  it('rejects a tampered session', () => {
    const value = createSessionValue(42, env, now)!;
    const [id, expiry, signature] = value.split('.');
    expect(readSession(`43.${expiry}.${signature}`, env, now)).toBeNull();
    expect(readSession(`${id}.${Number(expiry) + 86_400}.${signature}`, env, now)).toBeNull();
    expect(readSession(`${id}.${expiry}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`, env, now)).toBeNull();
    expect(readSession(`${id}.${expiry}`, env, now)).toBeNull();
    expect(readSession(`${id}.${expiry}.`, env, now)).toBeNull();
    expect(readSession('', env, now)).toBeNull();
    expect(readSession(null, env, now)).toBeNull();
    expect(readSession('1.9999999999.not-a-signature', env, now)).toBeNull();
  });

  it('rejects a session signed with another secret', () => {
    const value = createSessionValue(42, { AUTH_SECRET: 'another-secret-that-is-also-long-enough-987654' }, now)!;
    expect(readSession(value, env, now)).toBeNull();
  });

  it('rejects an expired session', () => {
    const value = createSessionValue(42, env, now)!;
    expect(readSession(value, env, new Date(now.getTime() + SESSION_TTL_MS - 1000))).not.toBeNull();
    expect(readSession(value, env, new Date(now.getTime() + SESSION_TTL_MS + 1000))).toBeNull();
  });

  it('fails closed without a usable secret: no cookie is issued and none is accepted', () => {
    const value = createSessionValue(42, env, now)!;
    for (const broken of [{}, { AUTH_SECRET: '' }, { AUTH_SECRET: 'short' }, { AUTH_SECRET: 'x'.repeat(31) }]) {
      expect(authSecret(broken)).toBeNull();
      expect(createSessionCookie(42, broken, now)).toBeNull();
      expect(readSession(value, broken, now)).toBeNull();
    }
    expect(authSecret({ AUTH_SECRET: 'x'.repeat(32) })).toBe('x'.repeat(32));
  });

  it('clears the cookie on sign-out', () => {
    expect(clearSessionCookie(env)).toMatch(new RegExp(`^${SESSION_COOKIE}=; Max-Age=0; .*HttpOnly`));
  });
});

describe('hashing', () => {
  it('stores a token only as its SHA-256', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes addresses with the secret, so the raw address is not recoverable from the store', () => {
    const hashed = hashIp('203.0.113.7', SECRET);
    expect(hashed).toMatch(/^[a-f0-9]{32}$/);
    expect(hashed).not.toContain('203');
    expect(hashIp('203.0.113.7', SECRET)).toBe(hashed);
    expect(hashIp('203.0.113.8', SECRET)).not.toBe(hashed);
    expect(hashIp('203.0.113.7', `${SECRET}x`)).not.toBe(hashed);
  });

  it('derives the idempotency key from user, kind, subject and every cache key part', () => {
    const key = idempotencyKey(1, 'translation', 'discovery:abc', ['v1', 'hi']);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(idempotencyKey(1, 'translation', 'discovery:abc', ['v1', 'hi'])).toBe(key);
    expect(idempotencyKey(2, 'translation', 'discovery:abc', ['v1', 'hi'])).not.toBe(key);
    expect(idempotencyKey(1, 'story', 'discovery:abc', ['v1', 'hi'])).not.toBe(key);
    expect(idempotencyKey(1, 'translation', 'discovery:abc', ['v2', 'hi'])).not.toBe(key);
    // Parts cannot be shifted across a boundary to collide.
    expect(idempotencyKey(1, 'translation', 'discovery:abc', ['v1h', 'i'])).not.toBe(key);
  });

  it('aligns windows to fixed boundaries', () => {
    expect(windowStartOf(new Date('2026-10-13T10:59:59Z'), HOUR).toISOString()).toBe('2026-10-13T10:00:00.000Z');
    expect(windowStartOf(new Date('2026-10-13T23:59:59Z'), DAY).toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });
});

describe('request helpers', () => {
  const Body = z.object({ token: z.string() }).strict();
  const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request('http://localhost/api/session', { method: 'POST', body, headers });

  it('parses a valid body', async () => {
    expect(await readJson(post('{"token":"t"}'), Body)).toEqual({ ok: true, data: { token: 't' } });
  });

  it('rejects malformed JSON, a wrong shape and unknown fields with 400', async () => {
    for (const [body, code] of [['{not json', 'invalid_json'], ['', 'invalid_json'], ['{"token":5}', 'invalid_request'], ['{"token":"t","admin":true}', 'invalid_request'], ['[]', 'invalid_request']]) {
      const result = await readJson(post(body), Body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        expect(await result.response.json()).toMatchObject({ code });
      }
    }
  });

  it('rejects an oversized body with 413, whether or not it declares its length', async () => {
    const big = JSON.stringify({ token: 'x'.repeat(5000) });
    const declared = await readJson(post(big, { 'content-length': String(big.length) }), Body, 1024);
    expect(!declared.ok && declared.response.status).toBe(413);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const undeclared = await readJson(new Request('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit), Body, 1024);
    expect(!undeclared.ok && undeclared.response.status).toBe(413);
  });

  it('refuses a cross-site browser request and accepts same-origin and non-browser ones', () => {
    const from = (origin?: string) => new Request('http://localhost/api/translate', { method: 'POST', headers: origin ? { origin, host: 'localhost' } : {} });
    expect(crossSite(from())).toBeNull();
    expect(crossSite(from('http://localhost'))).toBeNull();
    expect(crossSite(from('https://evil.example'))?.status).toBe(403);
    expect(crossSite(from('null'))?.status).toBe(403);
  });
});
