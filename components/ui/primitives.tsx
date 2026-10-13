import Link from 'next/link';
import { CircleAlert, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { CONFIDENCE_LABELS, type ConfidenceLevel } from '@/lib/types';
import { relativeTime, shortDate } from '@/lib/utils/time';

/** Only http(s) links are ever rendered; anything else from third-party data becomes inert. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

/** The credibility indicator: four bars plus a text label, so it never relies on colour alone. */
export function Confidence({ level, score, compact = false }: { level: ConfidenceLevel; score?: number; compact?: boolean }) {
  const label = CONFIDENCE_LABELS[level];
  return (
    <span className="inline-flex items-center gap-2 t-meta" title={score !== undefined ? `${label}: ${score} of 100` : label}>
      <span className="bars" data-level={level} aria-hidden="true"><i /><i /><i /><i /></span>
      <span className={compact ? 'sr-only' : undefined}>{label}</span>
    </span>
  );
}

export function TimeText({ iso, now, prefix }: { iso: string | null; now: string; prefix?: string }) {
  if (!iso) return <span>{prefix ? `${prefix} date unknown` : 'Date unknown'}</span>;
  return (
    <time dateTime={iso} title={shortDate(iso)}>
      {prefix ? `${prefix} ` : ''}{relativeTime(iso, now)}
    </time>
  );
}

export function Rule() {
  return <span aria-hidden="true" className="inline-block h-3 w-px shrink-0 bg-sep" />;
}

export function SectionHeader({ title, note, href, linkLabel }: { title: string; note?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div className="min-w-0">
        <h2 className="t-section">{title}</h2>
        {note ? <p className="t-meta mt-1 measure">{note}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="t-small font-medium text-link hover:underline">
          {linkLabel ?? 'See all'}
        </Link>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-14 text-center" role="status">
      <Inbox size={28} strokeWidth={1.5} className="text-fg3" aria-hidden="true" />
      <h3 className="t-card">{title}</h3>
      {children ? <div className="t-small text-fg2 measure">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-14 text-center" role="alert">
      <CircleAlert size={28} strokeWidth={1.5} className="text-bad" aria-hidden="true" />
      <h3 className="t-card">{title}</h3>
      {children ? <div className="t-small text-fg2 measure">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 t-small ${tone === 'warn' ? 'border-warn/40 text-fg' : 'border-sepsoft text-fg2'} bg-surface`} role={tone === 'warn' ? 'status' : undefined}>
      <CircleAlert size={17} className={`mt-0.5 shrink-0 ${tone === 'warn' ? 'text-warn' : 'text-fg3'}`} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card flex flex-col gap-3" aria-hidden="true">
      <div className="skeleton h-3 w-28" />
      <div className="skeleton h-5 w-4/5" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-2/3" />
      <div className="skeleton mt-3 h-3 w-32" />
    </div>
  );
}

export function PageSkeleton({ label = 'Loading discoveries' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton mb-3 h-9 w-56" aria-hidden="true" />
      <div className="skeleton mb-8 h-4 w-80 max-w-full" aria-hidden="true" />
      <div className="grid gap-[var(--gap)] sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
      </div>
    </div>
  );
}

export function PageHeader({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-7">
      <h1 className="t-page">{title}</h1>
      {lede ? <p className="t-body mt-2 text-fg2 measure">{lede}</p> : null}
      {children}
    </header>
  );
}
