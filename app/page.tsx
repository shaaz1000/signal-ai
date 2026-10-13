import { TodayView } from '@/components/views/feeds';
import { buildToday } from '@/lib/feed/query';
import { getFeedData, getPrefs } from '@/lib/server/data';

export default async function TodayPage() {
  const [prefs, data] = await Promise.all([getPrefs(), getFeedData()]);
  return <TodayView sections={buildToday(data.views, prefs, data.featuredId)} status={data.status} now={new Date().toISOString()} />;
}
