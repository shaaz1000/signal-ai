import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Content Radar' };

export default function ContentRadarPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="content" searchParams={searchParams} title="Content Radar" layout="content"
      lede="Verified stories ranked by how well they can be explained: new, with a documented mechanism or a general explainer, and not yet covered everywhere. Unverified items never appear here."
    />
  );
}
