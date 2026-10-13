import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StudioView } from '@/components/views/learn';
import { getFeedData } from '@/lib/server/data';

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: 'Creator Studio' };

export default async function StudioPage({ params }: { params: Params }) {
  const { id } = await params;
  const d = (await getFeedData()).views.find((v) => v.id === id);
  if (!d) notFound();
  return <StudioView d={d} />;
}
