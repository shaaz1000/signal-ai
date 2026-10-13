import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'GitHub Radar' };

export default function RadarPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="radar" searchParams={searchParams} title="GitHub Radar" layout="repos" showCategories={false}
      lede="Repositories gaining momentum. Growth is measured between our own snapshots; where only one snapshot exists you see the average since creation, labelled as such."
    />
  );
}
