import type { Metadata } from 'next';
import { Freshness } from '@/components/views/feeds';
import { StatusPanel } from '@/components/views/library';
import { RefreshButton } from '@/components/ui/controls';
import { PageHeader } from '@/components/ui/primitives';
import { getFeedData } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Pipeline status' };

export default async function StatusPage() {
  const { status } = await getFeedData();
  const now = new Date().toISOString();
  return (
    <>
      <PageHeader title="Pipeline status" lede="Updates are periodic, not real time. Discovery is scheduled hourly by a workflow, though GitHub often starts runs late or skips some, whether or not anyone has this page open." />
      <div className="mb-7 flex flex-col gap-4">
        <Freshness status={status} now={now} />
        <div><RefreshButton /></div>
      </div>
      <StatusPanel status={status} now={now} />
    </>
  );
}
