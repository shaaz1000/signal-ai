'use client';

import Link from 'next/link';
import { Bookmark, CalendarDays, Compass, Ellipsis, FlaskConical, Gem, Newspaper, Radar, Settings, SignalHigh } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { QuickSearch, ThemeToggle } from '@/components/ui/controls';
import { usePrefs, useRefresh, useRememberedHref, useRoutePath } from '@/lib/client/platform';
import type { StatusView } from '@/lib/types';
import { relativeTime } from '@/lib/utils/time';

const PRIMARY = [
  { href: '/', label: 'Today', Icon: Newspaper },
  { href: '/discover', label: 'Discover', Icon: Compass },
  { href: '/radar', label: 'GitHub Radar', Icon: Radar },
  { href: '/research', label: 'Research Lab', Icon: FlaskConical },
  { href: '/gems', label: 'Hidden Gems', Icon: Gem },
  { href: '/weekly', label: 'What You Missed', Icon: CalendarDays },
];
const LIBRARY = [
  { href: '/bookmarks', label: 'Saved', Icon: Bookmark },
  { href: '/settings', label: 'Settings', Icon: Settings },
];
const TABS = [
  { href: '/', label: 'Today', Icon: Newspaper },
  { href: '/discover', label: 'Discover', Icon: Compass },
  { href: '/radar', label: 'Radar', Icon: Radar },
  { href: '/research', label: 'Research', Icon: FlaskConical },
  { href: '/more', label: 'More', Icon: Ellipsis },
];
const MORE_PATHS = ['/more', '/gems', '/weekly', '/bookmarks', '/settings', '/status'];

const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

function NavItem({ href, label, Icon, path }: { href: string; label: string; Icon: typeof Newspaper; path: string }) {
  // Returning to a section restores the filters last used there.
  const remembered = useRememberedHref(href);
  return (
    <li>
      <Link href={remembered} className="nav-link" aria-current={isActive(path, href) ? 'page' : undefined}>
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </Link>
    </li>
  );
}

function TabItem({ href, label, Icon, path }: { href: string; label: string; Icon: typeof Newspaper; path: string }) {
  const remembered = useRememberedHref(href);
  const active = href === '/more' ? MORE_PATHS.some((p) => isActive(path, p)) : isActive(path, href);
  return (
    <li className="flex flex-1">
      <Link href={remembered} className="tab-link" aria-current={active ? 'page' : undefined}>
        <Icon size={21} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </Link>
    </li>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="inline-flex min-h-10 items-center gap-2 text-[1.0625rem] font-bold tracking-[-0.01em]">
      <SignalHigh size={20} className="text-link" aria-hidden="true" />
      <span>SIGNAL <span className="font-normal text-fg2">/</span> AI</span>
    </Link>
  );
}

function statusLine(status: StatusView | null, now: string): { text: string; tone: 'ok' | 'warn' } {
  if (!status) return { text: 'Status unavailable', tone: 'warn' };
  if (status.dataMode === 'empty') return { text: 'No data yet', tone: 'warn' };
  if (status.dataMode === 'fixture') return { text: 'Demonstration data', tone: 'warn' };
  const at = status.lastIngestion?.finishedAt ?? null;
  if (status.storage === 'snapshot') {
    const old = at ? new Date(now).getTime() - new Date(at).getTime() > 86_400_000 : true;
    return { text: `Snapshot from ${relativeTime(at, now)}`, tone: old ? 'warn' : 'ok' };
  }
  if (status.stale) return { text: `Stale: updated ${relativeTime(at, now)}`, tone: 'warn' };
  return { text: `Updated ${relativeTime(at, now)}`, tone: status.lastIngestion?.status === 'degraded' ? 'warn' : 'ok' };
}

function AutoRefresh() {
  const { prefs } = usePrefs();
  const { refresh } = useRefresh();
  useEffect(() => {
    if (!prefs.autoRefreshMinutes) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, prefs.autoRefreshMinutes * 60_000);
    return () => window.clearInterval(id);
  }, [prefs.autoRefreshMinutes, refresh]);
  return null;
}

export function Shell({ status, now, children }: { status: StatusView | null; now: string; children: ReactNode }) {
  const path = useRoutePath();
  const line = statusLine(status, now);
  const statusLink = (
    <Link href="/status" className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 t-meta hover:bg-fill">
      <span className={`h-2 w-2 shrink-0 rounded-full ${line.tone === 'ok' ? 'bg-good' : 'bg-warn'}`} aria-hidden="true" />
      <span className="truncate">{line.text}</span>
    </Link>
  );
  return (
    <div className="min-h-dvh lg:pl-[248px]">
      <a href="#main" className="btn btn-primary fixed left-4 top-4 z-50 -translate-y-24 focus:translate-y-0">Skip to content</a>
      <AutoRefresh />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-sepsoft bg-bg px-4 pb-4 pt-6 lg:flex">
        <div className="px-2"><Wordmark /></div>
        <div className="mt-5"><QuickSearch id="nav-search" /></div>
        <nav aria-label="Sections" className="mt-5 flex flex-1 flex-col gap-6 overflow-y-auto">
          <ul className="flex flex-col gap-0.5">{PRIMARY.map((item) => <NavItem key={item.href} {...item} path={path} />)}</ul>
          <div>
            <h2 className="mb-1.5 px-3 text-xs font-semibold text-fg2">Library</h2>
            <ul className="flex flex-col gap-0.5">{LIBRARY.map((item) => <NavItem key={item.href} {...item} path={path} />)}</ul>
          </div>
        </nav>
        <div className="flex items-center justify-between gap-1 border-t border-sepsoft pt-3">
          <div className="min-w-0 flex-1">{statusLink}</div>
          <ThemeToggle />
        </div>
      </aside>

      <header className="sticky z-30 flex items-center justify-between gap-3 border-b border-sepsoft bg-bg/95 px-4 py-2 backdrop-blur lg:hidden" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <Wordmark />
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0">{statusLink}</div>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1240px] px-4 pb-32 pt-6 outline-none sm:px-6 lg:px-10 lg:pb-20 lg:pt-10">
        {children}
      </main>

      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-sepsoft bg-bg/95 backdrop-blur lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <ul className="mx-auto flex max-w-xl">
          {TABS.map((tab) => <TabItem key={tab.href} {...tab} path={path} />)}
        </ul>
      </nav>
    </div>
  );
}
