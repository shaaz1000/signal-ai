import type { DiscoveryView } from '@/lib/types';

export interface SavedItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  category: string;
  kind: string;
  savedAt: string;
  collection: string;
}

export interface BookmarkState {
  items: SavedItem[];
  collections: string[];
}

export const DEFAULT_COLLECTION = 'Reading list';
export const EMPTY_BOOKMARKS: BookmarkState = { items: [], collections: [DEFAULT_COLLECTION] };

export interface BookmarkPersistence {
  /** Synchronous first read (may be empty) so the first paint is stable. */
  loadSync(): BookmarkState | null;
  /** Optional authoritative read, e.g. from a server-side store. */
  loadAsync?(): Promise<BookmarkState | null>;
  save(state: BookmarkState): void | Promise<void>;
  /** Where saved items live, shown to the user. */
  describe(): string;
}

export function sanitizeBookmarks(raw: unknown): BookmarkState | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<BookmarkState>;
  if (!Array.isArray(v.items)) return null;
  const items = v.items
    .filter((i): i is SavedItem => Boolean(i) && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.url === 'string')
    .slice(0, 500)
    .map((i) => ({
      id: i.id.slice(0, 40), title: i.title.slice(0, 300), summary: String(i.summary ?? '').slice(0, 400), url: i.url.slice(0, 2000),
      category: String(i.category ?? ''), kind: String(i.kind ?? ''), savedAt: String(i.savedAt ?? ''), collection: String(i.collection || DEFAULT_COLLECTION).slice(0, 60),
    }));
  const collections = [...new Set([DEFAULT_COLLECTION, ...(Array.isArray(v.collections) ? v.collections.map((c) => String(c).slice(0, 60)) : []), ...items.map((i) => i.collection)])];
  return { items, collections };
}

export function createBookmarkStore(persistence: BookmarkPersistence) {
  let state: BookmarkState = EMPTY_BOOKMARKS;
  let hydrated = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    try {
      state = sanitizeBookmarks(persistence.loadSync()) ?? EMPTY_BOOKMARKS;
    } catch {
      state = EMPTY_BOOKMARKS;
    }
    emit();
    persistence.loadAsync?.().then((remote) => {
      const clean = sanitizeBookmarks(remote);
      if (clean) {
        state = clean;
        emit();
      }
    }).catch(() => undefined);
  };

  const commit = (next: BookmarkState) => {
    state = next;
    emit();
    try {
      void Promise.resolve(persistence.save(next)).catch(() => undefined);
    } catch {
      // Storage can be unavailable (private windows). The session copy still works.
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      hydrate();
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    getServerSnapshot: () => EMPTY_BOOKMARKS,
    describe: () => persistence.describe(),
    toggle(d: Pick<DiscoveryView, 'id' | 'headline' | 'summary' | 'canonicalUrl' | 'category' | 'kind'>, collection = DEFAULT_COLLECTION): boolean {
      hydrate(); // Never overwrite stored bookmarks from an unread state.
      const exists = state.items.some((i) => i.id === d.id);
      commit(exists
        ? { ...state, items: state.items.filter((i) => i.id !== d.id) }
        : { ...state, items: [{ id: d.id, title: d.headline, summary: d.summary, url: d.canonicalUrl, category: d.category, kind: d.kind, savedAt: new Date().toISOString(), collection }, ...state.items] });
      return !exists;
    },
    remove(id: string) {
      hydrate(); // Never overwrite stored bookmarks from an unread state.
      commit({ ...state, items: state.items.filter((i) => i.id !== id) });
    },
    move(id: string, collection: string) {
      hydrate(); // Never overwrite stored bookmarks from an unread state.
      commit({ ...state, items: state.items.map((i) => (i.id === id ? { ...i, collection } : i)) });
    },
    addCollection(name: string): boolean {
      hydrate(); // Never overwrite stored bookmarks from an unread state.
      const clean = name.trim().slice(0, 60);
      if (!clean || state.collections.some((c) => c.toLowerCase() === clean.toLowerCase())) return false;
      commit({ ...state, collections: [...state.collections, clean] });
      return true;
    },
    removeCollection(name: string) {
      hydrate(); // Never overwrite stored bookmarks from an unread state.
      if (name === DEFAULT_COLLECTION) return;
      commit({
        collections: state.collections.filter((c) => c !== name),
        items: state.items.map((i) => (i.collection === name ? { ...i, collection: DEFAULT_COLLECTION } : i)),
      });
    },
  };
}

export type BookmarkStore = ReturnType<typeof createBookmarkStore>;

const KEY = 'signal.bookmarks.v1';

export const localStoragePersistence: BookmarkPersistence = {
  loadSync() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as BookmarkState) : null;
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Ignore: quota or blocked storage.
    }
  },
  describe: () => 'Saved in this browser only. They are not synced to other devices.',
};
