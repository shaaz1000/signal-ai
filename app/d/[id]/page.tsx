import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleView } from '@/components/views/learn';
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
  const { id } = await params;
  const data = await getFeedData();
  const d = data.views.find((v) => v.id === id);
  if (!d) notFound();
  const generated = Object.fromEntries(Object.entries(data.generated).filter(([, r]) => r.subject === `discovery:${id}`));
  return <ArticleView d={d} generated={generated} now={new Date().toISOString()} backHref={d.kind === 'repository' ? '/radar' : '/discover'} />;
}
