'use client';

/**
 * Everything the shared components need from their host. This file is the
 * Next.js implementation; the Artifact build swaps in `artifact/platform.tsx`
 * with the same exports, which is how one set of components runs in both.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react';
import { DEFAULT_QUERY, parseQuery, toSearchParams, type FeedQuery } from '@/lib/feed/query';
import { applyPrefsToDocument, DEFAULT_PREFS, PREFS_COOKIE, type Prefs } from '@/lib/prefs';
import { createBookmarkStore, localStoragePersistence } from './bookmarks';

export const PLATFORM: 'web' | 'artifact' = 'web';

export const bookmarkStore = createBookmarkStore(localStoragePersistence);

export function useBookmarks() {
  const state = useSyncExternalStore(bookmarkStore.subscribe, bookmarkStore.getSnapshot, bookmarkStore.getServerSnapshot);
  return { state, store: bookmarkStore };
}

const PrefsContext = createContext<{ prefs: Prefs; setPrefs: (patch: Partial<Prefs>) => void }>({ prefs: DEFAULT_PREFS, setPrefs: () => undefined });

export function PrefsProvider({ initial, children }: { initial: Prefs; children: ReactNode }) {
  const router = useRouter();
  const [prefs, setState] = useState(initial);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      applyPrefsToDocument(next);
      // A cookie (not localStorage) so the server can render the right theme and feed on first paint.
      document.cookie = `${PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
    router.refresh();
  }, [router]);
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  return useContext(PrefsContext);
}

export function useRoutePath(): string {
  return usePathname() ?? '/';
}

export function useNavigate(): (href: string) => void {
  const router = useRouter();
  return useCallback((href: string) => router.push(href), [router]);
}

const REMEMBER_KEY = 'signal.lastQuery';
const noSubscription = () => () => undefined;
function remembered(): Record<string, string> {
  try {
    return JSON.parse(window.sessionStorage.getItem(REMEMBER_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Reads and writes feed filters as URL parameters, so any filtered view is a shareable link. */
export function useQueryNav(defaults: Partial<FeedQuery> = {}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const defaultsKey = JSON.stringify(defaults);

  const go = useCallback((next: FeedQuery) => {
    const qs = toSearchParams(next, defaults);
    try {
      window.sessionStorage.setItem(REMEMBER_KEY, JSON.stringify({ ...remembered(), [pathname]: qs }));
    } catch {
      // Session storage is a convenience only.
    }
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, defaultsKey]);

  const setQuery = useCallback((patch: Partial<FeedQuery>) => {
    const current = parseQuery(Object.fromEntries(params?.entries() ?? []), defaults);
    go({ ...current, page: 1, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, go]);

  const reset = useCallback(() => go({ ...DEFAULT_QUERY, ...defaults }), [go]); // eslint-disable-line react-hooks/exhaustive-deps
  return { setQuery, reset, pending };
}

/** Href for a section that restores the filters last used there in this tab. */
export function useRememberedHref(path: string): string {
  // Re-read on every render (each navigation re-renders the nav); the server snapshot is the bare path.
  return useSyncExternalStore(noSubscription, () => {
    const qs = remembered()[path];
    return qs ? `${path}?${qs}` : path;
  }, () => path);
}

export function useRefresh() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  return { refresh, refreshing };
}
