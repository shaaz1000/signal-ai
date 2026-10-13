/**
 * Artifact implementation of `lib/client/platform`. Same exports as the
 * Next.js version, backed by an in-page store instead of the router: routes
 * are bare hash tokens (the only deep link the Artifact frame passes through),
 * data is a snapshot file published next to the page, and preferences live in
 * this browser.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_QUERY, parseQuery, type FeedQuery } from '@/lib/feed/query';
import { SCOPES } from '@/lib/feed/scopes';
import { applyPrefsToDocument, parsePrefs, type Prefs } from '@/lib/prefs';
import type { Snapshot } from '@/lib/types';
import { createBookmarkStore, localStoragePersistence, type BookmarkPersistence, type BookmarkState } from '@/lib/client/bookmarks';

export const PLATFORM: 'web' | 'artifact' = 'artifact';

type Load = { state: 'loading' } | { state: 'ready'; snapshot: Snapshot; loadedAt: string } | { state: 'error'; message: string };

interface State {
  path: string;
  queries: Record<string, FeedQuery>;
  prefs: Prefs;
  load: Load;
  refreshing: boolean;
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked; the page works without it.
  }
};

// ── Routing ────────────────────────────────────────────────────────────────

export function pathToToken(path: string): string {
  if (path === '/' || path === '') return 'today';
  return path.replace(/^\//, '').replace(/\//g, '-');
}

export function tokenToPath(token: string): string {
  const t = token.replace(/^#/, '');
  if (!t || t === 'today') return '/';
  if (/^d-[a-f0-9]{12}$/.test(t)) return `/d/${t.slice(2)}`;
  return /^[a-z]+$/.test(t) ? `/${t}` : '/';
}

export function hrefToHash(href: string): string {
  return `#${pathToToken(href.split('?')[0])}`;
}

const scopeDefaults = (path: string, prefs: Prefs): Partial<FeedQuery> => {
  const scope = SCOPES[path.slice(1) as keyof typeof SCOPES] as { defaults?: Partial<FeedQuery> } | undefined;
  return { ...(scope?.defaults ?? {}), window: prefs.window };
};

// ── Store ──────────────────────────────────────────────────────────────────

const initialPrefs = parsePrefs(read('signal.prefs'));
let state: State = {
  path: tokenToPath(window.location.hash),
  queries: {},
  prefs: initialPrefs,
  load: { state: 'loading' },
  refreshing: false,
};
try {
  const saved = JSON.parse(read('signal.queries') ?? '{}') as Record<string, Record<string, string>>;
  for (const [path, params] of Object.entries(saved)) state.queries[path] = parseQuery(params, scopeDefaults(path, initialPrefs));
} catch {
  // Ignore unreadable saved filters.
}
applyPrefsToDocument(initialPrefs);

const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useStore = <T,>(select: (s: State) => T): T => useSyncExternalStore(subscribe, () => select(state));

export function queryFor(path: string, s: State = state): FeedQuery {
  return s.queries[path] ?? { ...DEFAULT_QUERY, ...scopeDefaults(path, s.prefs) };
}

function saveQueries(queries: Record<string, FeedQuery>) {
  const out: Record<string, Partial<FeedQuery>> = {};
  for (const [path, q] of Object.entries(queries)) out[path] = { ...q, page: 1 };
  write('signal.queries', JSON.stringify(out));
}

export function navigateTo(href: string) {
  const [path, search] = href.split('?');
  if (search) {
    const params = Object.fromEntries(new URLSearchParams(search).entries());
    const queries = { ...state.queries, [path]: parseQuery(params, scopeDefaults(path, state.prefs)) };
    saveQueries(queries);
    set({ queries });
  }
  const token = `#${pathToToken(path)}`;
  if (window.location.hash !== token) window.location.hash = token;
  else set({ path });
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  set({ path: tokenToPath(window.location.hash) });
  document.getElementById('main')?.focus({ preventScroll: true });
});

// ── Data ───────────────────────────────────────────────────────────────────

export async function loadSnapshot(manual = false) {
  if (manual) set({ refreshing: true });
  try {
    // The Artifact frame blocks every outside host, so the only data source is this published file.
    const res = await fetch('snapshot.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`The snapshot file returned HTTP ${res.status}.`);
    const snapshot = (await res.json()) as Snapshot;
    if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.discoveries)) throw new Error('The snapshot file is not in the expected format.');
    set({ load: { state: 'ready', snapshot, loadedAt: new Date().toISOString() }, refreshing: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Keep showing the data we already have if a refresh fails.
    if (state.load.state === 'ready') set({ refreshing: false });
    else set({ load: { state: 'error', message }, refreshing: false });
  }
}

// ── Hooks with the same signatures as the Next.js platform ─────────────────

export function useRoutePath(): string {
  return useStore((s) => s.path);
}

export function useNavigate(): (href: string) => void {
  return navigateTo;
}

export function useRememberedHref(path: string): string {
  return path;
}

export function useQueryNav(defaults: Partial<FeedQuery> = {}) {
  const path = useStore((s) => s.path);
  const defaultsKey = JSON.stringify(defaults);
  const setQuery = useCallback((patch: Partial<FeedQuery>) => {
    const queries = { ...state.queries, [path]: { ...queryFor(path), page: 1, ...patch } };
    saveQueries(queries);
    set({ queries });
  }, [path]);
  const reset = useCallback(() => {
    const queries = { ...state.queries, [path]: { ...DEFAULT_QUERY, ...defaults } };
    saveQueries(queries);
    set({ queries });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, defaultsKey]);
  return { setQuery, reset, pending: false };
}

export function usePrefs() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    const next = { ...state.prefs, ...patch };
    applyPrefsToDocument(next);
    write('signal.prefs', JSON.stringify(next));
    set({ prefs: next });
  }, []);
  return { prefs, setPrefs };
}

export function useRefresh() {
  const refreshing = useStore((s) => s.refreshing);
  const refresh = useCallback(() => void loadSnapshot(true), []);
  return { refresh, refreshing };
}

// ── Bookmarks: per-viewer, in the Artifact's database when available ───────

interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface ClaudeRuntime {
  use(name: 'db'): Promise<{ collection(path: string): { doc(id: string): DocRef } } | null>;
  use(name: 'user'): Promise<{ id(): Promise<string | null> } | null>;
}

let remoteDoc: Promise<DocRef | null> | null = null;
let remoteActive = false;
function bookmarkDoc(): Promise<DocRef | null> {
  remoteDoc ??= (async () => {
    const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
    if (!claude?.use) return null;
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    const id = db && user ? await user.id() : null;
    // Each viewer's subtree is private to them; nobody else can read it, the owner included.
    return db && id ? db.collection(`data/users/${id}`).doc('bookmarks') : null;
  })().catch(() => null);
  return remoteDoc;
}

const artifactPersistence: BookmarkPersistence = {
  loadSync: () => localStoragePersistence.loadSync(),
  async loadAsync() {
    const doc = await bookmarkDoc();
    if (!doc) return null;
    const snap = await doc.get();
    remoteActive = true;
    listeners.forEach((l) => l());
    return snap.exists ? ((snap.data() ?? null) as BookmarkState | null) : null;
  },
  async save(next) {
    localStoragePersistence.save(next);
    const doc = await bookmarkDoc();
    await doc?.set(next as unknown as Record<string, unknown>).catch(() => undefined);
  },
  describe: () => (remoteActive
    ? 'Saved to your account on this page. Only you can see them, on any device where you are signed in.'
    : 'Saved in this browser only. Sign in to claude.ai to keep them with your account.'),
};

export const bookmarkStore = createBookmarkStore(artifactPersistence);

export function useBookmarks() {
  const bookmarks = useSyncExternalStore(bookmarkStore.subscribe, bookmarkStore.getSnapshot);
  useStore((s) => s.prefs); // Re-render when the storage location becomes known.
  return { state: bookmarks, store: bookmarkStore };
}
