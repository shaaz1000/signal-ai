import type { ReactNode } from 'react';
import { FeedView } from '@/components/views/feeds';
import { parseQuery, queryFeed } from '@/lib/feed/query';
import { SCOPES, type ScopeConfig, type ScopeId } from '@/lib/feed/scopes';
import { getFeedData, getPrefs, type SearchParams } from '@/lib/server/data';

interface Props {
  scope: ScopeId;
  searchParams: SearchParams;
  title: string;
  lede: string;
  layout?: 'cards' | 'repos' | 'content';
  showCategories?: boolean;
  showIndustries?: boolean;
  note?: ReactNode;
}

/** Shared server component behind Discover, Radar, Research Lab, Hidden Gems and Unverified. */
export async function FeedPage({ scope, searchParams, title, lede, layout, showCategories, showIndustries, note }: Props) {
  const [params, prefs, data] = await Promise.all([searchParams, getPrefs(), getFeedData()]);
  const config: ScopeConfig = SCOPES[scope];
  const defaults = { ...config.defaults, window: prefs.window };
  const query = parseQuery(params, defaults);
  const now = new Date().toISOString();
  const result = queryFeed(data.views, query, now, prefs, config);
  return (
    <FeedView
      title={title} lede={lede} result={result} query={query} defaults={defaults} now={now} layout={layout}
      sorts={config.sorts} showCategories={showCategories} showIndustries={showIndustries} status={data.status} note={note}
    />
  );
}
