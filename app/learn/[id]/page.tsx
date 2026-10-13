import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LearnDetailView } from '@/components/views/learn';
import { getFeedData } from '@/lib/server/data';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const d = (await getFeedData()).views.find((v) => v.id === id);
  return { title: d ? `How it works: ${d.headline}` : 'Not found' };
}

export default async function LearnDetailPage({ params, searchParams }: { params: Params; searchParams: Promise<{ mode?: string }> }) {
  const [{ id }, { mode }, data] = await Promise.all([params, searchParams, getFeedData()]);
  const d = data.views.find((v) => v.id === id);
  if (!d) notFound();
  const generated = Object.fromEntries(Object.entries(data.generated).filter(([, r]) => r.subject === `discovery:${id}`));
  return <LearnDetailView d={d} generated={generated} now={new Date().toISOString()} initialMode={mode === 'story' ? 'story' : 'explain'} />;
}
