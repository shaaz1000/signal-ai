import { CATEGORY_IDS, type CategoryId, type SourceGroup } from '@/lib/types';
import type { WindowId } from '@/lib/feed/query';
import { UI_LANGUAGES } from '@/lib/i18n/languages';

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  hiddenCategories: CategoryId[];
  hiddenGroups: SourceGroup[];
  /** Default discovery time window for feeds. */
  window: WindowId;
  /** Minutes between automatic refreshes while the page is visible. 0 turns it off. */
  autoRefreshMinutes: 0 | 5 | 15 | 60;
  /** Preferred reading language for explanations and stories. */
  language: string;
  /** Starting depth in Learn. */
  layer: 'simple' | 'analogy' | 'how' | 'deep' | 'real-world';
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  density: 'comfortable',
  hiddenCategories: [],
  hiddenGroups: [],
  window: 'all',
  autoRefreshMinutes: 0,
  language: 'en',
  layer: 'simple',
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
      language: UI_LANGUAGES.some((l) => l.code === v.language) ? (v.language as string) : 'en',
      layer: v.layer === 'analogy' || v.layer === 'how' || v.layer === 'deep' || v.layer === 'real-world' ? v.layer : 'simple',
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
