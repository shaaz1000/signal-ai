import Link from 'next/link';
import type { ReactNode } from 'react';
import { CompactRow, DiscoveryCard, FeaturedStory, RepoRow } from '@/components/discovery/card';
import { FilterBar, LoadMore } from '@/components/discovery/filter-bar';
import { ContentRadarList } from '@/components/views/learn';
import { RefreshButton } from '@/components/ui/controls';
import { EmptyState, Notice, PageHeader, SectionHeader } from '@/components/ui/primitives';
import type { FeedQuery, FeedResult, SortId, TodaySections } from '@/lib/feed/query';
import { categoryName, type DiscoveryView, type StatusView, type WeeklyEdition } from '@/lib/types';
import { dateTime, relativeTime, shortDate } from '@/lib/utils/time';

/** States the truth about how current the data is, on every editorial page. */
export function Freshness({ status, now, level = 'full' }: { status: StatusView | null; now: string; level?: 'full' | 'critical' }) {
  if (!status) return <Notice tone="warn">The data service did not respond, so freshness is unknown.</Notice>;
  if (status.dataMode === 'empty') return null;
  const finished = status.lastIngestion?.finishedAt ?? null;
  const snapshot = status.storage === 'snapshot';
  // Feed pages only carry warnings; routine coverage notes live on Today and the status page.
  const failed = level === 'full' ? status.lastIngestion?.providers.filter((p) => p.status === 'failed') ?? [] : [];
  const ageHours = finished ? (new Date(now).getTime() - new Date(finished).getTime()) / 3_600_000 : Infinity;
  if (level === 'critical' && status.dataMode === 'ingested' && !status.stale && !(snapshot && ageHours > 24)) return null;
  return (
    <div className="flex flex-col gap-3">
      {status.dataMode === 'fixture' ? (
        <Notice tone="warn">You are looking at demonstration fixtures for interface development. None of these items are real discoveries. Run the ingestion pipeline to replace them.</Notice>
      ) : null}
      {status.stale && !snapshot ? (
        <Notice tone="warn">This data is stale. The last successful ingestion finished {relativeTime(finished, now)}, and the schedule is every three hours.</Notice>
      ) : null}
      {failed.length && status.dataMode === 'ingested' ? (
        <Notice>Coverage was reduced in the last run: {failed.map((p) => p.name).join(', ')} did not respond. Other sources were processed normally.</Notice>
      ) : null}
      {snapshot && status.dataMode === 'ingested' ? (
        <Notice tone={ageHours > 24 ? 'warn' : 'info'}>
          This page shows a snapshot exported from the ingestion run that finished {dateTime(finished)} ({relativeTime(finished, now)}). It cannot reach GitHub or any other source by itself, so it does not update on its own.
        </Notice>
      ) : null}
    </div>
  );
}

function FreshnessLine({ status, now }: { status: StatusView | null; now: string }) {
  if (!status || status.dataMode === 'empty') return null;
  const finished = status.lastIngestion?.finishedAt ?? null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 t-meta">
        <div><dt className="inline">Last ingestion </dt><dd className="inline text-fg">{finished ? relativeTime(finished, now) : 'never'}</dd></div>
        <div><dt className="inline">Last verification </dt><dd className="inline text-fg">{status.lastVerification?.finishedAt ? relativeTime(status.lastVerification.finishedAt, now) : 'never'}</dd></div>
        {status.storage !== 'snapshot' ? <div><dt className="inline">Next scheduled run </dt><dd className="inline text-fg">{dateTime(status.nextScheduledIngestion)}</dd></div> : null}
        <div><dt className="inline">New in 24 h </dt><dd className="inline t-num text-fg">{status.counts.last24h}</dd></div>
      </dl>
      <RefreshButton label={status.storage === 'snapshot' ? 'Reload snapshot' : 'Refresh'} />
    </div>
  );
}

function CardGrid({ items, now, columns = 3 }: { items: DiscoveryView[]; now: string; columns?: 2 | 3 }) {
  return (
    <ul className={`grid gap-[var(--gap)] sm:grid-cols-2 ${columns === 3 ? 'xl:grid-cols-3' : ''}`}>
      {items.map((d) => <li key={d.id} className="min-w-0"><DiscoveryCard d={d} now={now} /></li>)}
    </ul>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section className="mt-12">{children}</section>;
}

export function TodayView({ sections, status, now }: { sections: TodaySections; status: StatusView | null; now: string }) {
  const s = sections;
  const empty = !s.featured && s.top.length === 0;
  return (
    <>
      <PageHeader title="Today" lede={`What people are building, releasing and testing right now. ${shortDate(now)}.`} />
      <div className="mb-6 flex flex-col gap-4">
        <FreshnessLine status={status} now={now} />
        <Freshness status={status} now={now} />
      </div>

      {empty ? (
        <EmptyState title="Nothing has been ingested yet">
          The discovery pipeline has not written any records. Run <code className="font-mono text-[0.9em]">npm run pipeline</code>, or wait for the next scheduled run.
        </EmptyState>
      ) : null}

      {s.featured ? <FeaturedStory d={s.featured} now={now} /> : null}

      {s.top.length ? (
        <Section>
          <SectionHeader title="Top discoveries" note="Ranked on novelty, momentum, significance and credibility together." href="/discover" />
          <CardGrid items={s.top} now={now} />
        </Section>
      ) : null}

      {s.repos.length ? (
        <Section>
          <SectionHeader title="Trending on GitHub" note="Ordered by momentum, not by lifetime stars." href="/radar" linkLabel="Open GitHub Radar" />
          <ul className="group-list">{s.repos.map((d) => <li key={d.id}><RepoRow d={d} now={now} /></li>)}</ul>
        </Section>
      ) : null}

      {s.tools.length ? (
        <Section>
          <SectionHeader title="New AI tools" href="/discover?category=ai-tools" />
          <CardGrid items={s.tools} now={now} columns={2} />
        </Section>
      ) : null}

      <div className="grid gap-x-[var(--gap)] lg:grid-cols-2">
        {s.research.length ? (
          <Section>
            <SectionHeader title="Research worth reading" note="Preprints are labelled; none are confirmed results." href="/research" />
            <ul className="group-list">{s.research.map((d) => <li key={d.id}><CompactRow d={d} now={now} /></li>)}</ul>
          </Section>
        ) : null}
        {s.experiments.length ? (
          <Section>
            <SectionHeader title="Experimental projects" note="Browser, games, creative and robotics." href="/discover?category=gaming-browser" />
            <ul className="group-list">{s.experiments.map((d) => <li key={d.id}><CompactRow d={d} now={now} /></li>)}</ul>
          </Section>
        ) : null}
      </div>

      {s.gems.length ? (
        <Section>
          <SectionHeader title="Hidden gems" note="Low visibility, strong novelty." href="/gems" />
          <CardGrid items={s.gems} now={now} columns={2} />
        </Section>
      ) : null}

      {s.recent.length ? (
        <Section>
          <SectionHeader title="Recent updates" href="/discover?sort=latest" />
          <ul className="group-list">{s.recent.map((d) => <li key={d.id}><CompactRow d={d} now={now} /></li>)}</ul>
        </Section>
      ) : null}

      {s.unverified.length ? (
        <Section>
          <SectionHeader title="Unverified" note="Collected but not confirmed. Kept apart from everything above and excluded from rankings." />
          <ul className="group-list">{s.unverified.map((d) => <li key={d.id}><CompactRow d={d} now={now} /></li>)}</ul>
        </Section>
      ) : null}
    </>
  );
}

interface FeedViewProps {
  title: string;
  lede: string;
  result: FeedResult;
  query: FeedQuery;
  defaults?: Partial<FeedQuery>;
  now: string;
  layout?: 'cards' | 'repos' | 'content';
  sorts?: SortId[];
  showCategories?: boolean;
  showIndustries?: boolean;
  status: StatusView | null;
  note?: ReactNode;
}

export function FeedView({ title, lede, result, query, defaults, now, layout = 'cards', sorts, showCategories = true, showIndustries = false, status, note }: FeedViewProps) {
  const hasData = (status?.counts.total ?? 0) > 0;
  return (
    <>
      <PageHeader title={title} lede={lede} />
      <div className="mb-5 flex flex-col gap-3 empty:hidden"><Freshness status={status} now={now} level="critical" />{note}</div>
      <FilterBar
        query={query} defaults={defaults} total={result.total} mode={layout === 'repos' ? 'radar' : 'feed'}
        languages={result.languages} sorts={sorts} showCategories={showCategories} showIndustries={showIndustries}
        searchLabel={layout === 'repos' ? 'Search repositories, owners and topics' : undefined}
      />
      {result.items.length === 0 ? (
        <EmptyState title={hasData ? 'No discoveries match these filters' : 'Nothing has been ingested yet'}>
          {hasData
            ? 'Try a wider time window, a different category, or clear the search.'
            : 'The pipeline has not written any records yet.'}
        </EmptyState>
      ) : layout === 'content' ? (
        <ContentRadarList items={result.items} />
      ) : layout === 'repos' ? (
        <ul className="group-list">{result.items.map((d) => <li key={d.id}><RepoRow d={d} now={now} /></li>)}</ul>
      ) : (
        <CardGrid items={result.items} now={now} />
      )}
      <LoadMore query={query} defaults={defaults} shown={result.items.length} total={result.total} />
    </>
  );
}

export function WeeklyView({ weekly, items, now, status }: { weekly: WeeklyEdition | null; items: DiscoveryView[]; now: string; status: StatusView | null }) {
  const byId = new Map(items.map((d) => [d.id, d]));
  const sections = (weekly?.sections ?? [])
    .map((s) => ({ ...s, items: s.ids.map((id) => byId.get(id)).filter((d): d is DiscoveryView => Boolean(d)) }))
    .filter((s) => s.items.length);
  return (
    <>
      <PageHeader title="What You Missed" lede="A weekly digest built only from discoveries that passed verification." />
      <div className="mb-6 empty:hidden"><Freshness status={status} now={now} level="critical" /></div>
      {!weekly || sections.length === 0 ? (
        <EmptyState title="No weekly edition yet">
          The edition is generated by the daily curation job once verified discoveries exist for the past seven days.
        </EmptyState>
      ) : (
        <>
          <div className="card !p-6 sm:!p-8">
            <p className="t-meta">{shortDate(weekly.weekStart)} to {shortDate(weekly.weekEnd)}</p>
            <p className="t-body mt-2 measure">{weekly.intro}</p>
            <p className="t-meta mt-3">Generated {dateTime(weekly.generatedAt)} from pipeline records. The counts above are computed, not written by hand.</p>
          </div>
          {sections.map((s) => (
            <Section key={s.category}>
              <SectionHeader title={categoryName(s.category)} href={`/discover?category=${s.category}`} />
              <CardGrid items={s.items} now={now} />
            </Section>
          ))}
        </>
      )}
    </>
  );
}

const MORE_LINKS = [
  { href: '/trending', title: 'Trending', text: 'Topics gaining or losing ground, from stored snapshots.' },
  { href: '/models', title: 'AI Models', text: 'New model releases, with claims kept apart from tested results.' },
  { href: '/industries', title: 'Industries', text: 'AI in medicine, defence, robotics, finance and more.' },
  { href: '/radar', title: 'GitHub Radar', text: 'Repositories gaining momentum.' },
  { href: '/research', title: 'Research Lab', text: 'Papers, models and research demos.' },
  { href: '/content', title: 'Content Radar', text: 'Verified stories worth explaining, and a studio to draft them.' },
  { href: '/gems', title: 'Hidden Gems', text: 'Low-visibility projects with strong novelty scores.' },
  { href: '/weekly', title: 'What You Missed', text: 'The weekly digest of verified discoveries.' },
  { href: '/bookmarks', title: 'Saved', text: 'Your saved items and collections.' },
  { href: '/settings', title: 'Settings', text: 'Theme, topics, sources, density and refresh.' },
  { href: '/account', title: 'Account', text: 'Sign in to request translations and AI drafts.' },
  { href: '/status', title: 'Pipeline status', text: 'Which sources responded and when data last changed.' },
];

export function MoreView() {
  return (
    <>
      <PageHeader title="More" />
      <ul className="group-list">
        {MORE_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="row hover-surface block">
              <span className="t-card block">{l.title}</span>
              <span className="t-meta mt-0.5 block">{l.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
