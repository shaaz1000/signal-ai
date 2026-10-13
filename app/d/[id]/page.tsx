import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DetailView } from '@/components/discovery/detail';
import { getFeedData } from '@/lib/server/data';

type Params = Promise<{ id: string }>;

async function find(id: string) {
  const data = await getFeedData();
  return data.views.find((v) => v.id === id) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const d = await find((await params).id);
  return d ? { title: d.headline, description: d.summary } : { title: 'Not found' };
}

export default async function DiscoveryPage({ params }: { params: Params }) {
  const d = await find((await params).id);
  if (!d) notFound();
  return <DetailView d={d} now={new Date().toISOString()} backHref={d.kind === 'repository' ? '/radar' : '/discover'} />;
}
