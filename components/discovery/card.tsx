import Link from 'next/link';
import { Activity, ArrowUpRight, GitFork, Star } from 'lucide-react';
import { categoryName, CLAIM_LABELS, type DiscoveryView, type Kind } from '@/lib/types';
import { EVIDENCE_STAGES, type EvidenceStage } from '@/lib/industries';
import { fmtInt } from '@/lib/utils/text';
import { relativeTime } from '@/lib/utils/time';
import { Confidence, ExternalLink, Rule, TimeText } from '@/components/ui/primitives';
import { BookmarkButton } from './bookmark-button';

export const KIND_LABELS: Record<Kind, string> = {
  repository: 'Repository', paper: 'Paper', model: 'Model', demo: 'Demo', article: 'Article', product: 'Launch', post: 'Discussion',
};

export function primarySourceName(d: DiscoveryView): string {
  return (d.sources.find((s) => s.primary) ?? d.sources[0])?.sourceName ?? 'Unknown source';
}

/** The one-line, measured reason an item is in the feed. */
export function signalLine(d: DiscoveryView): string | null {
  return d.reasons.find((r) => !r.startsWith('First picked up')) ?? d.reasons[0] ?? null;
}

export function growthText(d: DiscoveryView): { value: string; label: string } {
  const g = d.repo?.growth;
  if (g?.observedDelta != null && g.observedHours != null) {
    return { value: `${g.observedDelta >= 0 ? '+' : ''}${fmtInt(g.observedDelta)}`, label: `stars in ${g.observedHours} h, observed` };
  }
  if (g?.starsPerDayLifetime != null) return { value: `${fmtInt(g.starsPerDayLifetime)}/day`, label: 'average since creation' };
  return { value: 'Not measured', label: 'needs two snapshots' };
}

function CardMeta({ d }: { d: DiscoveryView }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 t-meta">
      <span className="font-medium text-fg">{categoryName(d.category)}</span>
      {/* "Repository" next to "GitHub" says the same thing twice. */}
      {d.kind === 'repository' ? null : <><Rule /><span>{d.kind === 'paper' || d.kind === 'article' ? CLAIM_LABELS[d.claimType] : KIND_LABELS[d.kind]}</span></>}
      <Rule />
      <span className="truncate">{primarySourceName(d)}</span>
    </div>
  );
}

export function DiscoveryCard({ d, now }: { d: DiscoveryView; now: string }) {
  const signal = signalLine(d);
  return (
    <article className="card hover-surface relative flex h-full min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <CardMeta d={d} />
        <BookmarkButton item={d} />
      </div>
      <h3 className="t-card break-anywhere">
        <Link href={`/d/${d.id}`} className="stretch-link">{d.headline}</Link>
      </h3>
      <p className="t-small text-fg2 clamp-3 break-anywhere">{d.summary}</p>
      {d.model || d.evidenceStage?.cue ? (
        <ul className="flex flex-wrap gap-1.5">
          {d.model?.openWeights === true ? <li className="tag">Open weights</li> : null}
          {d.model?.license ? <li className="tag">{d.model.license}</li> : null}
          {d.model && !d.model.independentlyTested ? <li className="tag">Publisher’s claims</li> : null}
          {d.evidenceStage?.cue ? <li className="tag">{EVIDENCE_STAGES[d.evidenceStage.stage as EvidenceStage] ?? d.evidenceStage.stage}</li> : null}
        </ul>
      ) : null}
      {signal ? (
        <p className="flex items-start gap-2 t-meta text-fg">
          <Activity size={14} className="mt-0.5 shrink-0 text-link" aria-hidden="true" />
          <span className="clamp-2">{signal}</span>
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1 t-meta">
        <Confidence level={d.confidenceLevel} score={d.confidence} />
        <span className="flex items-center gap-2.5">
          {d.repo?.stars != null ? (
            <span className="inline-flex items-center gap-1 t-num"><Star size={13} aria-hidden="true" /><span className="sr-only">Stars: </span>{fmtInt(d.repo.stars)}</span>
          ) : null}
          <TimeText iso={d.publishedAt ?? d.firstDiscoveredAt} now={now} />
        </span>
      </div>
    </article>
  );
}

const SCORE_ROWS = [
  ['novelty', 'Novelty'], ['momentum', 'Momentum'], ['significance', 'Significance'], ['credibility', 'Credibility'],
] as const;

export function FeaturedStory({ d, now }: { d: DiscoveryView; now: string }) {
  return (
    <article className="card hover-surface relative grid gap-8 !p-6 sm:!p-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-12">
      <div className="flex min-w-0 flex-col gap-4">
        <CardMeta d={d} />
        <h2 className="t-hero break-anywhere">
          <Link href={`/d/${d.id}`} className="stretch-link">{d.headline}</Link>
        </h2>
        <p className="t-body text-fg2 measure clamp-3 break-anywhere">{d.editorial.what}</p>
        <div className="lift mt-1 flex flex-wrap items-center gap-2.5">
          <Link href={`/d/${d.id}`} className="btn btn-primary">Read the brief</Link>
          {d.conceptId || d.editorial.how ? <Link href={`/learn/${d.id}`} className="btn">Understand how it works</Link> : null}
          <ExternalLink href={d.canonicalUrl} className="btn">
            Open original <ArrowUpRight size={15} aria-hidden="true" />
          </ExternalLink>
          <BookmarkButton item={d} variant="button" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:border-l lg:border-sepsoft lg:pl-10">
        <div>
          <h3 className="t-meta font-medium text-fg">Why it is trending</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {d.reasons.slice(0, 3).map((r) => (
              <li key={r} className="flex items-start gap-2 t-small">
                <Activity size={14} className="mt-1 shrink-0 text-link" aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          {SCORE_ROWS.map(([key, label]) => (
            <div key={key}>
              <dt className="flex items-baseline justify-between t-meta">
                <span>{label}</span>
                <span className="t-num text-fg">{Math.round(d.scores[key])}</span>
              </dt>
              <dd className="meter mt-1.5" aria-hidden="true"><span style={{ width: `${Math.round(d.scores[key])}%` }} /></dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-2 t-meta">
          <Confidence level={d.confidenceLevel} score={d.confidence} />
          <span>Picked up {relativeTime(d.firstDiscoveredAt, now)}</span>
        </div>
      </div>
    </article>
  );
}

/** One repository in a grouped list. Total stars and observed growth are shown side by side, never merged. */
export function RepoRow({ d, now }: { d: DiscoveryView; now: string }) {
  const repo = d.repo;
  if (!repo) return null;
  const growth = growthText(d);
  const signal = signalLine(d);
  return (
    <article className="row hover-surface relative grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h3 className="t-card break-anywhere">
            <Link href={`/d/${d.id}`} className="stretch-link">
              <span className="font-normal text-fg2">{repo.owner}/</span>{repo.name}
            </Link>
          </h3>
          <span className="md:hidden"><BookmarkButton item={d} /></span>
        </div>
        <p className="t-small mt-1 text-fg2 clamp-2 break-anywhere">{d.summary}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 t-meta">
          {repo.language ? <span className="font-medium text-fg">{repo.language}</span> : null}
          {repo.language ? <Rule /> : null}
          <TimeText iso={repo.createdAt} now={now} prefix="Created" />
          <Rule />
          <TimeText iso={repo.pushedAt} now={now} prefix="Pushed" />
          {d.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
        {signal ? (
          <p className="mt-2.5 flex items-start gap-2 t-meta text-fg">
            <Activity size={14} className="mt-0.5 shrink-0 text-link" aria-hidden="true" />
            <span>{signal}</span>
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-6 md:justify-end">
        <dl className="grid grid-cols-[auto_auto] items-start gap-x-6 md:min-w-[230px] md:grid-cols-2 md:text-right">
          <div className="flex flex-col gap-1 md:items-end">
            <dt className="t-meta">Stars</dt>
            <dd className="t-card t-num inline-flex items-center gap-1"><Star size={14} className="text-fg3" aria-hidden="true" />{repo.stars != null ? fmtInt(repo.stars) : 'n/a'}</dd>
            <dd className="t-meta inline-flex items-center gap-1">
              <GitFork size={12} aria-hidden="true" /><span className="t-num">{repo.forks != null ? fmtInt(repo.forks) : 'n/a'}</span> forks
            </dd>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <dt className="t-meta">Growth</dt>
            <dd className="t-card t-num">{growth.value}</dd>
            <dd className="t-meta">{growth.label}</dd>
          </div>
        </dl>
        <div className="hidden flex-col items-end gap-2 md:flex">
          <BookmarkButton item={d} />
          <Confidence level={d.confidenceLevel} score={d.confidence} compact />
        </div>
        <span className="md:hidden"><Confidence level={d.confidenceLevel} score={d.confidence} /></span>
      </div>
    </article>
  );
}

/** Dense single-line row for secondary lists. */
export function CompactRow({ d, now }: { d: DiscoveryView; now: string }) {
  return (
    <article className="row hover-surface relative flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="t-small font-semibold break-anywhere">
          <Link href={`/d/${d.id}`} className="stretch-link">{d.headline}</Link>
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 t-meta">
          <span>{categoryName(d.category)}</span>
          <Rule />
          <span>{primarySourceName(d)}</span>
          <Rule />
          <TimeText iso={d.publishedAt ?? d.firstDiscoveredAt} now={now} />
        </div>
      </div>
      <Confidence level={d.confidenceLevel} score={d.confidence} compact />
    </article>
  );
}
