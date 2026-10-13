import type { Metadata } from 'next';
import { WeeklyView } from '@/components/views/feeds';
import { getFeedData } from '@/lib/server/data';

export const metadata: Metadata = { title: 'What You Missed' };

export default async function WeeklyPage() {
  const data = await getFeedData();
  return <WeeklyView weekly={data.weekly} items={data.views} now={new Date().toISOString()} status={data.status} />;
}
