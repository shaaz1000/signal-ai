'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Segmented } from '@/components/ui/controls';
import { useQueryNav } from '@/lib/client/platform';
import { ACTIVITY, isDefaultQuery, REPO_AGES, SORTS, WINDOWS, type FeedQuery, type SortId } from '@/lib/feed/query';
import { CATEGORIES } from '@/lib/types';

interface Props {
  query: FeedQuery;
  defaults?: Partial<FeedQuery>;
  total: number;
  /** Radar adds language, age and activity filters. */
  mode?: 'feed' | 'radar';
  languages?: string[];
  sorts?: SortId[];
  showCategories?: boolean;
  searchLabel?: string;
}

export function FilterBar({ query, defaults = {}, total, mode = 'feed', languages = [], sorts, showCategories = true, searchLabel = 'Search titles, descriptions, tags and repository names' }: Props) {
  const { setQuery, reset, pending } = useQueryNav(defaults);
  const [text, setText] = useState(query.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(query.q);

  // Keep the box in step when the URL changes underneath it (back button, reset, shared link).
  useEffect(() => {
    if (query.q !== lastSent.current) {
      lastSent.current = query.q;
      setText(query.q);
    }
  }, [query.q]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onSearch = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastSent.current = value.trim();
      setQuery({ q: value.trim() });
    }, 280);
  };
  const clearAll = () => {
    if (timer.current) clearTimeout(timer.current);
    lastSent.current = '';
    setText('');
    reset();
  };

  const sortOptions = SORTS.filter((s) => !sorts || sorts.includes(s.id));
  const filtered = !isDefaultQuery(query, defaults);

  const sortSelect = (
    <>
      <label htmlFor="feed-sort" className="sr-only">Sort by</label>
      <select id="feed-sort" className="field" value={query.sort} onChange={(e) => setQuery({ sort: e.target.value as SortId })}>
        {sortOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </>
  );

  return (
    <section aria-label="Filters" className="mb-6 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-[1_1_260px]">
          <label htmlFor="feed-search" className="sr-only">{searchLabel}</label>
          <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg3" aria-hidden="true" />
          <input
            id="feed-search" type="search" value={text} onChange={(e) => onSearch(e.target.value)} placeholder={searchLabel}
            autoComplete="off" enterKeyHint="search" className="field !pl-10"
          />
        </div>
        {sortOptions.length > 1 && mode === 'feed' ? <div className="flex-[1_1_180px] sm:flex-[0_1_220px]">{sortSelect}</div> : null}
      </div>

      {mode === 'radar' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div>{sortSelect}</div>
          <div>
            <label htmlFor="radar-language" className="sr-only">Language</label>
            <select id="radar-language" className="field" value={query.language} onChange={(e) => setQuery({ language: e.target.value })}>
              <option value="">Any language</option>
              {languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="radar-age" className="sr-only">Repository age</label>
            <select id="radar-age" className="field" value={query.age} onChange={(e) => setQuery({ age: e.target.value as FeedQuery['age'] })}>
              {REPO_AGES.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="radar-activity" className="sr-only">Recent activity</label>
            <select id="radar-activity" className="field" value={query.activity} onChange={(e) => setQuery({ activity: e.target.value as FeedQuery['activity'] })}>
              {ACTIVITY.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      ) : null}

      {showCategories ? (
        <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
          <div role="group" aria-label="Category" className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            <button type="button" className="chip" aria-pressed={query.category === 'all'} onClick={() => setQuery({ category: 'all' })}>All</button>
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={query.category === c.id} onClick={() => setQuery({ category: query.category === c.id ? 'all' : c.id })}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="scroll-x max-w-full">
          <Segmented label="Time window" options={WINDOWS} value={query.window} onChange={(id) => setQuery({ window: id })} />
        </div>
        <div className="flex items-center gap-3 t-meta">
          <span aria-live="polite" className="t-num">{pending ? 'Updating' : `${total} ${total === 1 ? 'result' : 'results'}`}</span>
          {filtered ? (
            <button type="button" className="btn btn-quiet !min-h-9" onClick={clearAll}>
              <X size={14} aria-hidden="true" /> Reset filters
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function LoadMore({ query, defaults = {}, shown, total }: { query: FeedQuery; defaults?: Partial<FeedQuery>; shown: number; total: number }) {
  const { setQuery, pending } = useQueryNav(defaults);
  if (shown >= total) return total > 0 ? <p className="mt-8 text-center t-meta">Showing all {total}.</p> : null;
  return (
    <div className="mt-8 flex flex-col items-center gap-2">
      <button type="button" className="btn" disabled={pending} aria-busy={pending} onClick={() => setQuery({ page: query.page + 1 })}>
        {pending ? 'Loading' : 'Show more'}
      </button>
      <p className="t-meta t-num">Showing {shown} of {total}</p>
    </div>
  );
}
