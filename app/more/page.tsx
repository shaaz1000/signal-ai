import type { Metadata } from 'next';
import { MoreView } from '@/components/views/feeds';

export const metadata: Metadata = { title: 'More' };

export default function MorePage() {
  return <MoreView />;
}
