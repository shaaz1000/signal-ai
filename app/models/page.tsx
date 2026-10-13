import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import { Notice } from '@/components/ui/primitives';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'AI Models' };

export default function ModelsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="models" searchParams={searchParams} title="AI Models" showCategories={false}
      lede="New model releases from labs and independent publishers: who published it, whether the weights can be downloaded, the licence and the stated modalities."
      note={<Notice>Capabilities, benchmark results and prices on a release are the publisher’s statements until someone else tests them. Each card says which it is.</Notice>}
    />
  );
}
