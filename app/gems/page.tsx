import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Hidden Gems' };

export default function GemsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="gems" searchParams={searchParams} title="Hidden Gems"
      lede="Projects with under 1,500 stars, or little discussion, that still score well on novelty, significance and usefulness. High-star repositories are excluded by rule."
    />
  );
}
