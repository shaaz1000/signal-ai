import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Discover' };

export default function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="discover" searchParams={searchParams} title="Discover"
      lede="Every verified discovery, across tools, agents, models, research, robotics, creative work and browser experiments."
    />
  );
}
