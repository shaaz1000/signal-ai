import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Learn' };

export default function LearnPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="learn" searchParams={searchParams} title="Learn"
      lede="Discoveries you can take apart. Open one, choose “Understand how it works”, and read it at five depths, step through a diagram, or play it as a story."
    />
  );
}
