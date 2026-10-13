import type { Metadata } from 'next';
import { FeedPage } from '@/app/feed-page';
import { Notice } from '@/components/ui/primitives';
import type { SearchParams } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Research Lab' };

export default function ResearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <FeedPage
      scope="research" searchParams={searchParams} title="Research Lab" showCategories={false}
      lede="New papers, models and research demos. Each card says whether it is a preprint, a peer-reviewed paper, a company announcement or a third-party report."
      note={<Notice>A preprint is a claim, not a confirmed result. “Verified breakthroughs” here means high confidence that the work exists as described and that at least two independent sources reference it. It does not mean the findings were reproduced.</Notice>}
    />
  );
}
