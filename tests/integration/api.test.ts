import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '@/lib/db/client';
import { resetRateLimit } from '@/lib/server/rate-limit';
import type { DiscoveryView } from '@/lib/types';
import { seedFixtures } from '../fixtures/seed';

/** Route handlers are called directly against a seeded in-memory database. */
let close: () => Promise<void>;
let list: typeof import('@/app/api/discoveries/route').GET;
let one: typeof import('@/app/api/discoveries/[id]/route').GET;
let status: typeof import('@/app/api/status/route').GET;

const get = (path: string, ip = '203.0.113.7') => new Request(`http://localhost${path}`, { headers: { 'x-forwarded-for': ip } });

beforeAll(async () => {
  const handle = await createTestDb();
  close = handle.close;
  await seedFixtures(handle.db, new Date());
  // The app reads its connection from this process-wide slot.
  (globalThis as unknown as { __signalDb: Promise<typeof handle> }).__signalDb = Promise.resolve(handle);
  list = (await import('@/app/api/discoveries/route')).GET;
  one = (await import('@/app/api/discoveries/[id]/route')).GET;
  status = (await import('@/app/api/status/route')).GET;
});
afterAll(async () => {
  (globalThis as unknown as { __signalDb?: unknown }).__signalDb = undefined;
  await close();
});
beforeEach(() => resetRateLimit());

describe('GET /api/discoveries', () => {
  it('returns a page of gated, ranked discoveries', async () => {
    const res = await list(get('/api/discoveries'));
    expect(res.status).toBe(200);
    const body = await res.json() as { total: number; items: DiscoveryView[]; page: number };
    expect(body.total).toBeGreaterThan(5);
    expect(body.items.every((d) => d.confidenceLevel !== 'unverified')).toBe(true);
    expect(res.headers.get('cache-control')).toMatch(/s-maxage/);
  });

  it('searches across titles, tags and repository names', async () => {
    const body = await (await list(get('/api/discoveries?q=page-tracer'))).json() as { items: DiscoveryView[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].repo?.name).toBe('page-tracer');
  });

  it('scopes to repositories and filters by language', async () => {
    const body = await (await list(get('/api/discoveries?scope=radar&language=Rust'))).json() as { items: DiscoveryView[] };
    expect(body.items.map((d) => d.repo?.language)).toEqual(['Rust']);
  });

  it('falls back to defaults for unknown parameter values instead of erroring', async () => {
    const res = await list(get('/api/discoveries?sort=%27%3B%20drop%20table&category=nope&page=-4&scope=bogus'));
    expect(res.status).toBe(200);
    const body = await res.json() as { query: { sort: string; category: string; page: number }; scope: string };
    expect(body).toMatchObject({ scope: 'discover', query: { sort: 'trending', category: 'all', page: 1 } });
  });

  it('rate limits a client that exceeds 60 requests a minute, without affecting others', async () => {
    for (let i = 0; i < 60; i++) expect((await list(get('/api/discoveries', '198.51.100.9'))).status).toBe(200);
    const blocked = await list(get('/api/discoveries', '198.51.100.9'));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await list(get('/api/discoveries', '198.51.100.10'))).status).toBe(200);
  });
});

describe('GET /api/discoveries/[id] and /api/status', () => {
  it('validates the id format', async () => {
    const res = await one(get('/api/discoveries/../../etc'), { params: Promise.resolve({ id: '../../etc' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown id and the record for a known one', async () => {
    expect((await one(get('/api/discoveries/000000000000'), { params: Promise.resolve({ id: '000000000000' }) })).status).toBe(404);
    const { items } = await (await list(get('/api/discoveries'))).json() as { items: DiscoveryView[] };
    const res = await one(get(`/api/discoveries/${items[0].id}`), { params: Promise.resolve({ id: items[0].id }) });
    expect(((await res.json()) as DiscoveryView).id).toBe(items[0].id);
  });

  it('reports fixture mode so demonstration data is never presented as ingested', async () => {
    const body = await (await status(get('/api/status'))).json() as { dataMode: string; counts: { total: number } };
    expect(body.dataMode).toBe('fixture');
    expect(body.counts.total).toBeGreaterThan(5);
  });
});
