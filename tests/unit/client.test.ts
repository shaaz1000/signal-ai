import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBookmarkStore, DEFAULT_COLLECTION, sanitizeBookmarks,
  type BookmarkPersistence, type BookmarkState,
} from '@/lib/client/bookmarks';
import { DEFAULT_PREFS, parsePrefs } from '@/lib/prefs';
import { clientKey, rateLimit, resetRateLimit } from '@/lib/server/rate-limit';

describe('parsePrefs', () => {
  it.each([[undefined], [null], [''], ['not json'], ['{"theme":'], ['null'], ['42'], ['"dark"'], ['[]']])('falls back to defaults for %j', (raw) => {
    expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('reads a complete, valid value', () => {
    const stored = { theme: 'dark', density: 'compact', hiddenCategories: ['robotics', 'launches'], hiddenGroups: ['news'], window: '7d', autoRefreshMinutes: 15, language: 'hi', layer: 'deep' };
    expect(parsePrefs(JSON.stringify(stored))).toEqual(stored);
  });

  it('fills in defaults for a partial value', () => {
    expect(parsePrefs('{"theme":"light"}')).toEqual({ ...DEFAULT_PREFS, theme: 'light' });
    expect(parsePrefs('{"window":"24h","autoRefreshMinutes":60}')).toEqual({ ...DEFAULT_PREFS, window: '24h', autoRefreshMinutes: 60 });
  });

  it('replaces invalid enum values with the defaults', () => {
    const raw = JSON.stringify({ theme: 'neon', density: 'cramped', window: '1y', autoRefreshMinutes: 7, hiddenCategories: 'robotics', hiddenGroups: { news: true } });
    expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('drops unknown categories and source groups but keeps valid ones', () => {
    const raw = JSON.stringify({ hiddenCategories: ['robotics', 'crypto', 7, null], hiddenGroups: ['news', 'tabloids'] });
    const prefs = parsePrefs(raw);
    expect(prefs.hiddenCategories).toEqual(['robotics']);
    expect(prefs.hiddenGroups).toEqual(['news']);
  });

  it('does not treat numeric strings as valid refresh intervals', () => {
    expect(parsePrefs('{"autoRefreshMinutes":"15"}').autoRefreshMinutes).toBe(0);
  });
});

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  const start = Date.parse('2026-03-01T12:00:00Z');

  it('allows requests up to the limit and reports what remains', () => {
    expect(rateLimit('203.0.113.7', start, 3)).toEqual({ ok: true, remaining: 2, retryAfter: 0 });
    expect(rateLimit('203.0.113.7', start + 1000, 3)).toMatchObject({ ok: true, remaining: 1 });
    expect(rateLimit('203.0.113.7', start + 2000, 3)).toMatchObject({ ok: true, remaining: 0 });
  });

  it('blocks further requests with the seconds left in the window', () => {
    for (let i = 0; i < 3; i++) rateLimit('203.0.113.7', start, 3);
    expect(rateLimit('203.0.113.7', start + 15_000, 3)).toEqual({ ok: false, remaining: 0, retryAfter: 45 });
    expect(rateLimit('203.0.113.7', start + 59_500, 3)).toEqual({ ok: false, remaining: 0, retryAfter: 1 });
  });

  it('resets once the window has passed', () => {
    for (let i = 0; i < 5; i++) rateLimit('203.0.113.7', start, 3);
    expect(rateLimit('203.0.113.7', start + 59_999, 3).ok).toBe(false);
    expect(rateLimit('203.0.113.7', start + 60_000, 3)).toEqual({ ok: true, remaining: 2, retryAfter: 0 });
  });

  it('tracks each client separately', () => {
    for (let i = 0; i < 4; i++) rateLimit('203.0.113.7', start, 3);
    expect(rateLimit('203.0.113.7', start, 3).ok).toBe(false);
    expect(rateLimit('198.51.100.20', start, 3).ok).toBe(true);
  });

  it('allows sixty requests a minute by default', () => {
    const results = Array.from({ length: 61 }, () => rateLimit('203.0.113.7', start));
    expect(results.slice(0, 60).every((r) => r.ok)).toBe(true);
    expect(results[60].ok).toBe(false);
  });

  it('forgets everything on resetRateLimit', () => {
    for (let i = 0; i < 4; i++) rateLimit('203.0.113.7', start, 3);
    resetRateLimit();
    expect(rateLimit('203.0.113.7', start, 3).ok).toBe(true);
  });

  it('keys clients by the first forwarded address', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.20' }))).toBe('198.51.100.20');
    expect(clientKey(new Headers())).toBe('unknown');
  });
});

describe('bookmarks', () => {
  /** An in-memory stand-in for localStorage that stores a JSON copy, as a real one would. */
  function memory(initial: unknown = null) {
    let stored: string | null = initial === null ? null : JSON.stringify(initial);
    const save = vi.fn((state: BookmarkState) => {
      stored = JSON.stringify(state);
    });
    const persistence: BookmarkPersistence = {
      loadSync: () => (stored === null ? null : (JSON.parse(stored) as BookmarkState)),
      save,
      describe: () => 'Kept in memory for this test.',
    };
    return { persistence, save, read: () => (stored === null ? null : (JSON.parse(stored) as BookmarkState)) };
  }

  /** Stores hydrate on first subscription, as they do under useSyncExternalStore. */
  function open(persistence: BookmarkPersistence) {
    const store = createBookmarkStore(persistence);
    const listener = vi.fn();
    store.subscribe(listener);
    return { store, listener };
  }

  const vexdb = { id: 'a1b2c3d4e5f6', headline: 'VexDB: a small vector database', summary: 'A vector database for one machine.', canonicalUrl: 'https://github.com/acme/vexdb', category: 'dev-tools', kind: 'repository' } as const;
  const paper = { id: 'f6e5d4c3b2a1', headline: 'Sparse attention for long contexts', summary: 'A preprint on attention.', canonicalUrl: 'https://arxiv.org/abs/2501.01234', category: 'research', kind: 'paper' } as const;

  describe('createBookmarkStore', () => {
    it('starts empty with the default collection', () => {
      const { store } = open(memory().persistence);
      expect(store.getSnapshot()).toEqual({ items: [], collections: [DEFAULT_COLLECTION] });
      expect(store.describe()).toBe('Kept in memory for this test.');
    });

    it('adds an item on the first toggle and removes it on the second', () => {
      const { persistence, read } = memory();
      const { store, listener } = open(persistence);
      listener.mockClear();

      expect(store.toggle(vexdb)).toBe(true);
      expect(store.getSnapshot().items).toHaveLength(1);
      expect(store.getSnapshot().items[0]).toMatchObject({
        id: vexdb.id, title: vexdb.headline, summary: vexdb.summary, url: vexdb.canonicalUrl, category: 'dev-tools', kind: 'repository', collection: DEFAULT_COLLECTION,
      });
      expect(read()?.items).toHaveLength(1);
      expect(listener).toHaveBeenCalledTimes(1);

      expect(store.toggle(vexdb)).toBe(false);
      expect(store.getSnapshot().items).toEqual([]);
      expect(read()?.items).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('puts the most recently saved item first', () => {
      const { store } = open(memory().persistence);
      store.toggle(vexdb);
      store.toggle(paper);
      expect(store.getSnapshot().items.map((i) => i.id)).toEqual([paper.id, vexdb.id]);
    });

    it('survives a new store created over the same persistence', () => {
      const { persistence } = memory();
      const first = open(persistence).store;
      first.toggle(vexdb);
      first.addCollection('To try');
      first.move(vexdb.id, 'To try');

      const second = open(persistence).store;
      expect(second.getSnapshot().collections).toEqual([DEFAULT_COLLECTION, 'To try']);
      expect(second.getSnapshot().items).toHaveLength(1);
      expect(second.getSnapshot().items[0]).toMatchObject({ id: vexdb.id, collection: 'To try' });
      // And toggling in the new store removes the restored item rather than duplicating it.
      expect(second.toggle(vexdb)).toBe(false);
      expect(second.getSnapshot().items).toEqual([]);
    });

    it('stops notifying after unsubscribe', () => {
      const store = createBookmarkStore(memory().persistence);
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      listener.mockClear();
      unsubscribe();
      store.toggle(vexdb);
      expect(listener).not.toHaveBeenCalled();
    });

    it('adds collections but rejects duplicates and blank names', () => {
      const { store } = open(memory().persistence);
      expect(store.addCollection('  To try  ')).toBe(true);
      expect(store.addCollection('To try')).toBe(false);
      expect(store.addCollection('TO TRY')).toBe(false);
      expect(store.addCollection(DEFAULT_COLLECTION.toUpperCase())).toBe(false);
      expect(store.addCollection('')).toBe(false);
      expect(store.addCollection('   ')).toBe(false);
      expect(store.getSnapshot().collections).toEqual([DEFAULT_COLLECTION, 'To try']);
    });

    it('moves an item between collections without touching the others', () => {
      const { store } = open(memory().persistence);
      store.toggle(vexdb);
      store.toggle(paper);
      store.addCollection('Papers');
      store.move(paper.id, 'Papers');
      const byId = Object.fromEntries(store.getSnapshot().items.map((i) => [i.id, i.collection]));
      expect(byId).toEqual({ [paper.id]: 'Papers', [vexdb.id]: DEFAULT_COLLECTION });
    });

    it('returns items to the default collection when their collection is removed', () => {
      const { persistence, read } = memory();
      const { store } = open(persistence);
      store.addCollection('Papers');
      store.toggle(paper, 'Papers');
      store.toggle(vexdb);
      store.removeCollection('Papers');
      expect(store.getSnapshot().collections).toEqual([DEFAULT_COLLECTION]);
      expect(store.getSnapshot().items.map((i) => i.collection)).toEqual([DEFAULT_COLLECTION, DEFAULT_COLLECTION]);
      expect(store.getSnapshot().items).toHaveLength(2);
      expect(read()?.collections).toEqual([DEFAULT_COLLECTION]);
    });

    it('refuses to remove the default collection', () => {
      const { persistence, save } = memory();
      const { store } = open(persistence);
      store.toggle(vexdb);
      save.mockClear();
      store.removeCollection(DEFAULT_COLLECTION);
      expect(store.getSnapshot().collections).toEqual([DEFAULT_COLLECTION]);
      expect(save).not.toHaveBeenCalled();
    });

    it('removes a single item by id', () => {
      const { store } = open(memory().persistence);
      store.toggle(vexdb);
      store.toggle(paper);
      store.remove(vexdb.id);
      expect(store.getSnapshot().items.map((i) => i.id)).toEqual([paper.id]);
    });

    it('keeps working in memory when save throws', () => {
      const persistence: BookmarkPersistence = {
        loadSync: () => null,
        save: () => {
          throw new Error('QuotaExceededError');
        },
        describe: () => 'Broken storage',
      };
      const { store, listener } = open(persistence);
      listener.mockClear();
      expect(store.toggle(vexdb)).toBe(true);
      expect(store.addCollection('To try')).toBe(true);
      expect(store.getSnapshot().items).toHaveLength(1);
      expect(store.getSnapshot().collections).toEqual([DEFAULT_COLLECTION, 'To try']);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(store.toggle(vexdb)).toBe(false);
    });

    it('keeps working in memory when an asynchronous save rejects', async () => {
      const persistence: BookmarkPersistence = {
        loadSync: () => null,
        save: async () => {
          throw new Error('network down');
        },
        describe: () => 'Broken remote storage',
      };
      const { store } = open(persistence);
      expect(store.toggle(vexdb)).toBe(true);
      // Let the rejected promise settle; an unhandled rejection would fail the run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.getSnapshot().items).toHaveLength(1);
    });

    it('starts empty when loadSync throws or returns garbage', () => {
      const throwing: BookmarkPersistence = {
        loadSync: () => {
          throw new Error('SecurityError');
        },
        save: () => {},
        describe: () => 'Blocked storage',
      };
      expect(open(throwing).store.getSnapshot()).toEqual({ items: [], collections: [DEFAULT_COLLECTION] });
      expect(open(memory({ items: 'nope' }).persistence).store.getSnapshot()).toEqual({ items: [], collections: [DEFAULT_COLLECTION] });
    });

    it('prefers an authoritative asynchronous load when one is offered', async () => {
      const remote: BookmarkState = {
        items: [{ id: paper.id, title: paper.headline, summary: paper.summary, url: paper.canonicalUrl, category: 'research', kind: 'paper', savedAt: '2026-02-28T10:00:00.000Z', collection: 'Papers' }],
        collections: [DEFAULT_COLLECTION, 'Papers'],
      };
      const { store, listener } = open({ ...memory().persistence, loadAsync: async () => remote });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.getSnapshot()).toEqual(remote);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('sanitizeBookmarks', () => {
    const good = { id: 'a1b2c3d4e5f6', title: 'VexDB', summary: 'A vector database.', url: 'https://github.com/acme/vexdb', category: 'dev-tools', kind: 'repository', savedAt: '2026-02-28T10:00:00.000Z', collection: 'To try' };

    it.each([[null], [undefined], ['a string'], [42], [{}], [{ items: 'nope' }], [{ collections: ['Only collections'] }]])('rejects %j', (raw) => {
      expect(sanitizeBookmarks(raw)).toBeNull();
    });

    it('drops malformed entries and keeps well-formed ones', () => {
      const result = sanitizeBookmarks({
        items: [
          good,
          null,
          'a string',
          { id: 12, title: 'Numeric id', url: 'https://example.com' },
          { id: 'no-title', url: 'https://example.com' },
          { id: 'no-url', title: 'No URL' },
        ],
        collections: ['To try'],
      });
      expect(result?.items).toEqual([good]);
    });

    it('fills in optional fields and the default collection', () => {
      const result = sanitizeBookmarks({ items: [{ id: 'x1', title: 'Minimal', url: 'https://example.com/a' }] });
      expect(result?.items).toEqual([{ id: 'x1', title: 'Minimal', url: 'https://example.com/a', summary: '', category: '', kind: '', savedAt: '', collection: DEFAULT_COLLECTION }]);
      expect(result?.collections).toEqual([DEFAULT_COLLECTION]);
    });

    it('always includes the default collection and any collection an item uses', () => {
      const result = sanitizeBookmarks({ items: [good], collections: ['Archive', 'Archive'] });
      expect(result?.collections).toEqual([DEFAULT_COLLECTION, 'Archive', 'To try']);
    });

    it('bounds field lengths and the number of items', () => {
      const long = { ...good, id: 'i'.repeat(100), title: 't'.repeat(1000), summary: 's'.repeat(1000), collection: 'c'.repeat(200) };
      const one = sanitizeBookmarks({ items: [long] })?.items[0];
      expect(one?.id).toHaveLength(40);
      expect(one?.title).toHaveLength(300);
      expect(one?.summary).toHaveLength(400);
      expect(one?.collection).toHaveLength(60);

      const many = Array.from({ length: 600 }, (_, i) => ({ ...good, id: `id-${i}` }));
      expect(sanitizeBookmarks({ items: many })?.items).toHaveLength(500);
    });
  });
});
