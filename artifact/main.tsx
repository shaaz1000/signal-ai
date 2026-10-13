import type { ReactNode } from 'react';
import { Shell } from '@/components/navigation/shell';
import { RefreshButton } from '@/components/ui/controls';
import { EmptyState, ErrorState, Notice, PageHeader, PageSkeleton } from '@/components/ui/primitives';
import { FeedView, Freshness, MoreView, TodayView, WeeklyView } from '@/components/views/feeds';
import { AccountView } from '@/components/views/account';
import { ArticleView, LearnDetailView, StudioView, TrendingView } from '@/components/views/learn';
import { BookmarksView, SettingsView, StatusPanel } from '@/components/views/library';
import { buildToday, queryFeed } from '@/lib/feed/query';
import { SCOPES, type ScopeConfig, type ScopeId } from '@/lib/feed/scopes';
import type { Snapshot } from '@/lib/types';
import Link from './shims/next-link';
import { loadSnapshot, queryFor, useStore } from './platform';

const FEEDS: Record<string, { scope: ScopeId; title: string; lede: string; layout?: 'cards' | 'repos' | 'content'; showCategories?: boolean; showIndustries?: boolean; note?: ReactNode }> = {
  '/models': {
    scope: 'models', title: 'AI Models', showCategories: false,
    lede: 'New model releases from labs and independent publishers: who published it, whether the weights can be downloaded, the licence and the stated modalities.',
    note: <Notice>Capabilities, benchmark results and prices on a release are the publisher’s statements until someone else tests them. Each card says which it is.</Notice>,
  },
  '/industries': {
    scope: 'industries', title: 'Industries', showCategories: false, showIndustries: true,
    lede: 'How AI is being applied outside the lab. Choose an industry to narrow the list.',
    note: <Notice>For medicine and defence, each item shows how far along it says it is. Where the source does not say, nothing is assumed.</Notice>,
  },
  '/learn': { scope: 'learn', title: 'Learn', lede: 'Discoveries you can take apart. Open one, choose “Understand how it works”, and read it at five depths, step through a diagram, or play it as a story.' },
  '/content': { scope: 'content', title: 'Content Radar', layout: 'content', lede: 'Verified stories ranked by how well they can be explained: new, with a documented mechanism or a general explainer, and not yet covered everywhere. Unverified items never appear here.' },
  '/discover': { scope: 'discover', title: 'Discover', lede: 'Every verified discovery, across tools, agents, models, research, robotics, creative work and browser experiments.' },
  '/radar': { scope: 'radar', title: 'GitHub Radar', layout: 'repos', showCategories: false, lede: 'Repositories gaining momentum. Growth is measured between our own snapshots; where only one snapshot exists you see the average since creation, labelled as such.' },
  '/research': {
    scope: 'research', title: 'Research Lab', showCategories: false,
    lede: 'New papers, models and research demos. Each card says whether it is a preprint, a peer-reviewed paper, a company announcement or a third-party report.',
    note: <Notice>A preprint is a claim, not a confirmed result. “Verified breakthroughs” here means high confidence that the work exists as described and that at least two independent sources reference it. It does not mean the findings were reproduced.</Notice>,
  },
  '/gems': { scope: 'gems', title: 'Hidden Gems', lede: 'Projects with under 1,500 stars, or little discussion, that still score well on novelty, significance and usefulness. High-star repositories are excluded by rule.' },
  '/unverified': {
    scope: 'unverified', title: 'Unverified', lede: 'Items the pipeline collected but could not confirm. They are kept out of every other page.',
    note: <Notice tone="warn">Nothing here has passed verification. Open an item to see which checks failed or could not run.</Notice>,
  },
};

function Page({ snapshot, path, now }: { snapshot: Snapshot; path: string; now: string }) {
  const prefs = useStore((s) => s.prefs);
  const queries = useStore((s) => s.queries);
  const { status, discoveries } = snapshot;

  if (path === '/') return <TodayView sections={buildToday(discoveries, prefs, snapshot.featuredId)} status={status} now={now} />;
  const feed = FEEDS[path];
  if (feed) {
    const config: ScopeConfig = SCOPES[feed.scope];
    const defaults = { ...config.defaults, window: prefs.window };
    const query = queries[path] ?? queryFor(path);
    return (
      <FeedView
        title={feed.title} lede={feed.lede} result={queryFeed(discoveries, query, now, prefs, config)} query={query} defaults={defaults} now={now}
        layout={feed.layout} sorts={config.sorts} showCategories={feed.showCategories} showIndustries={feed.showIndustries} status={status} note={feed.note}
      />
    );
  }
  if (path.startsWith('/d/')) {
    const d = discoveries.find((x) => x.id === path.slice(3));
    if (d) {
      const generated = Object.fromEntries(Object.entries(snapshot.generated ?? {}).filter(([, r]) => r.subject === `discovery:${d.id}`));
      return <ArticleView key={d.id} d={d} generated={generated} now={now} backHref={d.kind === 'repository' ? '/radar' : '/discover'} />;
    }
    return (
      <EmptyState title="That discovery is not in this snapshot" action={<Link href="/discover" className="btn btn-primary">Browse discoveries</Link>}>
        The link may be from a newer or older snapshot than the one published here.
      </EmptyState>
    );
  }
  if (path.startsWith('/learn/') || path.startsWith('/studio/')) {
    const [, section, id] = path.split('/');
    const d = discoveries.find((x) => x.id === id);
    if (!d) return <EmptyState title="That discovery is not in this snapshot" action={<Link href="/learn" className="btn btn-primary">Browse Learn</Link>} />;
    const generated = Object.fromEntries(Object.entries(snapshot.generated ?? {}).filter(([, r]) => r.subject === `discovery:${id}`));
    return section === 'learn' ? <LearnDetailView key={id} d={d} generated={generated} now={now} /> : <StudioView key={id} d={d} />;
  }
  if (path === '/trending') return <TrendingView trends={snapshot.trends ?? []} items={discoveries} />;
  if (path === '/account') return <AccountView />;
  if (path === '/weekly') return <WeeklyView weekly={snapshot.weekly} items={discoveries} now={now} status={status} />;
  if (path === '/bookmarks') return <BookmarksView now={now} />;
  if (path === '/settings') return <SettingsView platform="artifact" />;
  if (path === '/more') return <MoreView />;
  if (path === '/status') {
    return (
      <>
        <PageHeader
          title="Pipeline status"
          lede={status.storage === 'site'
            ? 'Updates are periodic, not real time. A scheduled workflow runs discovery every three hours and republishes this site, whether or not anyone has it open.'
            : 'This page describes the ingestion run that produced the snapshot you are reading. The live pipeline runs in the companion application, every three hours.'}
        />
        <div className="mb-7 flex flex-col gap-4">
          <Freshness status={status} now={now} />
          <div><RefreshButton label={status.storage === 'site' ? 'Refresh' : 'Reload snapshot'} /></div>
        </div>
        <StatusPanel status={status} now={now} />
      </>
    );
  }
  return <EmptyState title="That page does not exist" action={<Link href="/" className="btn btn-primary">Go to Today</Link>} />;
}

export function App() {
  const load = useStore((s) => s.load);
  const path = useStore((s) => s.path);
  // Relative times are measured from when the page loaded the snapshot.
  const now = load.state === 'ready' ? load.loadedAt : new Date().toISOString();
  return (
    <Shell status={load.state === 'ready' ? load.snapshot.status : null} now={now}>
      {load.state === 'loading' ? <PageSkeleton label="Loading the discovery snapshot" /> : null}
      {load.state === 'error' ? (
        <ErrorState title="The discovery snapshot could not be loaded" action={<button type="button" className="btn btn-primary" onClick={() => void loadSnapshot(true)}>Try again</button>}>
          {load.message} This page reads one data file published alongside it and cannot reach any other source.
        </ErrorState>
      ) : null}
      {load.state === 'ready' ? <Page snapshot={load.snapshot} path={path} now={now} /> : null}
    </Shell>
  );
}

const rootElement = document.getElementById('signal-root');
if (rootElement) {
  const ReactDOM = (window as unknown as { ReactDOM: { createRoot(el: Element): { render(node: ReactNode): void } } }).ReactDOM;
  ReactDOM.createRoot(rootElement).render(<App />);
  void loadSnapshot();
}
