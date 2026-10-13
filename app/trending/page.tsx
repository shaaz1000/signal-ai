import type { Metadata } from 'next';
import { TrendingView } from '@/components/views/learn';
import { getFeedData } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Trending' };

export default async function TrendingPage() {
  const data = await getFeedData();
  return <TrendingView trends={data.trends} items={data.views} />;
}
