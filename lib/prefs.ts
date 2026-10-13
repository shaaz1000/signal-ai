import { CATEGORY_IDS, type CategoryId, type SourceGroup } from '@/lib/types';
import type { WindowId } from '@/lib/feed/query';

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  hiddenCategories: CategoryId[];
  hiddenGroups: SourceGroup[];
  /** Default discovery time window for feeds. */
  window: WindowId;
  /** Minutes between automatic refreshes while the page is visible. 0 turns it off. */
  autoRefreshMinutes: 0 | 5 | 15 | 60;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  density: 'comfortable',
  hiddenCategories: [],
  hiddenGroups: [],
  window: 'all',
  autoRefreshMinutes: 0,
};

export const PREFS_COOKIE = 'signal_prefs';
const GROUPS: SourceGroup[] = ['github', 'community', 'research', 'news', 'blog'];

/** Parses stored preferences defensively; anything unrecognised falls back to the default. */
export function parsePrefs(raw: string | undefined | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
      density: v.density === 'compact' ? 'compact' : 'comfortable',
      hiddenCategories: Array.isArray(v.hiddenCategories) ? v.hiddenCategories.filter((c) => CATEGORY_IDS.includes(c)) : [],
      hiddenGroups: Array.isArray(v.hiddenGroups) ? v.hiddenGroups.filter((g) => GROUPS.includes(g)) : [],
      window: v.window === '24h' || v.window === '7d' || v.window === '30d' ? v.window : 'all',
      autoRefreshMinutes: v.autoRefreshMinutes === 5 || v.autoRefreshMinutes === 15 || v.autoRefreshMinutes === 60 ? v.autoRefreshMinutes : 0,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefsToDocument(prefs: Prefs): void {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  if (prefs.density === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;
}
