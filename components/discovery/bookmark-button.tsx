'use client';

import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useBookmarks } from '@/lib/client/platform';
import type { DiscoveryView } from '@/lib/types';

type Saveable = Pick<DiscoveryView, 'id' | 'headline' | 'summary' | 'canonicalUrl' | 'category' | 'kind'>;

export function BookmarkButton({ item, variant = 'icon' }: { item: Saveable; variant?: 'icon' | 'button' }) {
  const { state, store } = useBookmarks();
  const saved = state.items.some((i) => i.id === item.id);
  const toggle = () => store.toggle(item);
  if (variant === 'button') {
    return (
      <button type="button" className="btn" aria-pressed={saved} onClick={toggle}>
        {saved ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
        {saved ? 'Saved' : 'Save'}
      </button>
    );
  }
  return (
    <button type="button" className="icon-btn lift -m-2" aria-pressed={saved} aria-label={saved ? `Remove ${item.headline} from saved` : `Save ${item.headline}`} onClick={toggle}>
      {saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
    </button>
  );
}
