import { cookies } from 'next/headers';
import { cache } from 'react';
import { getHandle } from '@/lib/db/client';
import { loadEdition, loadGenerated, loadStatus, loadViews, loadWeekly } from '@/lib/db/views';
import { loadTrends } from '@/lib/trends/run';
import { parsePrefs, PREFS_COOKIE, type Prefs } from '@/lib/prefs';
import type { DiscoveryView, GeneratedRecord, StatusView, TrendView, WeeklyEdition } from '@/lib/types';

export interface FeedData {
  views: DiscoveryView[];
  status: StatusView;
  weekly: WeeklyEdition | null;
  featuredId: string | null;
  trends: TrendView[];
  generated: Record<string, GeneratedRecord>;
}

/** How long one server instance reuses a loaded feed. Data only changes every three hours. */
const TTL_MS = 30_000;
let memo: { at: number; data: Promise<FeedData> } | null = null;

async function load(): Promise<FeedData> {
  const { db, kind } = await getHandle();
  const now = new Date();
  const [views, status, weekly, daily, trends] = await Promise.all([loadViews(db, now), loadStatus(db, kind, now), loadWeekly(db), loadEdition(db, 'daily'), loadTrends(db, now)]);
  const generated = await loadGenerated(db, new Set(views.map((v) => v.id)));
  return { views, status, weekly, featuredId: daily?.featuredId ?? null, trends, generated };
}

/** Feed data, deduplicated per request and briefly cached per server instance. */
export const getFeedData = cache(async (): Promise<FeedData> => {
  if (!memo || Date.now() - memo.at > TTL_MS) {
    const data = load();
    memo = { at: Date.now(), data };
    // A failed load must not be served from cache.
    data.catch(() => {
      if (memo?.data === data) memo = null;
    });
  }
  return memo.data;
});

export const getPrefs = cache(async (): Promise<Prefs> => parsePrefs((await cookies()).get(PREFS_COOKIE)?.value));

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
