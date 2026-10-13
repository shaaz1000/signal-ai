import type { Metadata } from 'next';
import { BookmarksView } from '@/components/views/library';

export const metadata: Metadata = { title: 'Saved' };

export default function BookmarksPage() {
  return <BookmarksView now={new Date().toISOString()} />;
}
