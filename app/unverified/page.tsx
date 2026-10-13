import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import { Notice } from '@/components/ui/primitives';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Unverified' };

export default function UnverifiedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="unverified" searchParams={searchParams} title="Unverified"
      lede="Items the pipeline collected but could not confirm. They are kept out of every other page."
      note={<Notice tone="warn">Nothing here has passed verification. Open an item to see which checks failed or could not run.</Notice>}
    />
  );
}
