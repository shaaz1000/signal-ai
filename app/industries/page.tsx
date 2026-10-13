import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import { Notice } from '@/components/ui/primitives';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Industries' };

export default function IndustriesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="industries" searchParams={searchParams} title="Industries" showCategories={false} showIndustries
      lede="How AI is being applied outside the lab. Choose an industry to narrow the list."
      note={<Notice>For medicine and defence, each item shows how far along it says it is: research, trial, clearance or deployment for medicine; concept, test, vendor claim or deployment for defence. Where the source does not say, nothing is assumed.</Notice>}
    />
  );
}
