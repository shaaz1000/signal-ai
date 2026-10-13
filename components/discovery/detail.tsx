import Link from 'next/link';
import { Activity, ArrowUpRight, BookOpen, ChevronLeft, CircleCheck, CircleHelp, CircleX, PenLine, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { categoryName, CLAIM_LABELS, EXECUTION_LABELS, type CheckOutcome, type DiscoveryView } from '@/lib/types';
import { EVIDENCE_STAGES, industryName, type EvidenceStage } from '@/lib/industries';
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights';
import { fmtInt } from '@/lib/utils/text';
import { dateTime, shortDate } from '@/lib/utils/time';
import { CopyLinkButton } from '@/components/ui/controls';
import { Confidence, ExternalLink, Notice, Rule, TimeText } from '@/components/ui/primitives';
import { BookmarkButton } from './bookmark-button';
import { growthText, KIND_LABELS } from './card';

const CHECK_LABELS: Record<string, string> = {
  url_exists: 'It exists', primary_source: 'Primary source', description_match: 'Descriptions agree', promotional_language: 'Promotional wording',
  metrics_available: 'Metrics from an API', dates_consistent: 'Dates', code_available: 'Public code', documentation: 'Documentation',
  corroboration: 'Independent references', execution_mode: 'How it runs', engagement_pattern: 'Engagement pattern', untrusted_content: 'Manipulative content',
  review_status: 'Peer review', repo_state: 'Repository state',
};

const OUTCOME: Record<CheckOutcome, { Icon: typeof CircleCheck; className: string; word: string }> = {
  pass: { Icon: CircleCheck, className: 'text-good', word: 'Passed' },
  warn: { Icon: TriangleAlert, className: 'text-warn', word: 'Caution' },
  fail: { Icon: CircleX, className: 'text-bad', word: 'Failed' },
  unknown: { Icon: CircleHelp, className: 'text-fg3', word: 'Not verified' },
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-sepsoft py-6 first:border-t-0 first:pt-0">
      <h2 className="t-section mb-2.5">{title}</h2>
      <div className="t-body measure break-anywhere prose-note">{children}</div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="t-card mb-3">{title}</h2>
      {children}
    </section>
  );
}

const SCORES = [
  ['novelty', 'Novelty'], ['momentum', 'Momentum'], ['significance', 'Technical significance'],
  ['credibility', 'Credibility'], ['usefulness', 'Practical usefulness'], ['freshness', 'Freshness'],
] as const;

export function DetailView({ d, now, backHref = '/discover' }: { d: DiscoveryView; now: string; backHref?: string }) {
  const growth = growthText(d);
  const e = d.editorial;
  return (
    <article>
      <Link href={backHref} className="mb-5 inline-flex min-h-10 items-center gap-1 t-small font-medium text-link hover:underline">
        <ChevronLeft size={16} aria-hidden="true" /> Back
      </Link>

      <header className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 t-meta">
          <span className="font-medium text-fg">{categoryName(d.category)}</span>
          <Rule />
          <span>{KIND_LABELS[d.kind]}</span>
          <Rule />
          <span>{CLAIM_LABELS[d.claimType]}</span>
        </div>
        <h1 className="t-page break-anywhere">{d.headline}</h1>
        <p className="t-body mt-3 text-fg2 measure break-anywhere">{d.summary}</p>
        <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-2 t-meta">
          <div><dt className="inline">By </dt><dd className="inline text-fg">{d.author && d.authorVerified ? d.author : 'author not verified'}</dd></div>
          <div><dt className="inline">Published </dt><dd className="inline text-fg">{d.publishedAt ? shortDate(d.publishedAt) : 'date not given by the source'}</dd></div>
          <div><dt className="inline">First picked up </dt><dd className="inline text-fg"><TimeText iso={d.firstDiscoveredAt} now={now} /></dd></div>
          <div><dt className="inline">Last verified </dt><dd className="inline text-fg">{d.lastVerifiedAt ? dateTime(d.lastVerifiedAt) : 'not yet'}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <ExternalLink href={d.canonicalUrl} className="btn btn-primary">
            Open original <ArrowUpRight size={15} aria-hidden="true" />
          </ExternalLink>
          <Link href={`/learn/${d.id}`} className="btn"><BookOpen size={15} aria-hidden="true" /> Understand how it works</Link>
          <Link href={`/studio/${d.id}`} className="btn"><PenLine size={15} aria-hidden="true" /> Create content</Link>
          <BookmarkButton item={d} variant="button" />
          <CopyLinkButton />
        </div>
        {d.industries.length || d.evidenceStage ? (
          <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-2 t-meta">
            {d.industries.length ? <div><dt className="inline">Industries </dt><dd className="inline text-fg">{d.industries.map(industryName).join(', ')}</dd></div> : null}
            {d.evidenceStage ? (
              <div>
                <dt className="inline">Stated maturity </dt>
                <dd className="inline text-fg">
                  {EVIDENCE_STAGES[d.evidenceStage.stage as EvidenceStage] ?? d.evidenceStage.stage}
                  {d.evidenceStage.cue ? ` (source says “${d.evidenceStage.cue}”)` : ' (implied by the type of source)'}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </header>

      {d.fixture ? <div className="mb-6"><Notice tone="warn">Demonstration record. It was created by the fixture seeder for interface development and does not describe a real project.</Notice></div> : null}
      {d.confidenceLevel === 'unverified' ? <div className="mb-6"><Notice tone="warn">Not verified. The checks on the right could not confirm enough about this item, so treat every claim below as unconfirmed.</Notice></div> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Block title="What is it?"><p>{e.what}</p></Block>
          <Block title="Why is it interesting?"><p>{e.why}</p></Block>
          <Block title="How does it work?">
            {e.how ? <p>{e.how}</p> : <p className="text-fg2">Not verified. The sources we read do not describe the implementation, so no explanation is given here.</p>}
            {d.executionMode ? <p><span className="font-medium">How it runs:</span> {EXECUTION_LABELS[d.executionMode]}, according to the source text.</p> : null}
          </Block>
          <Block title="Why is it trending?">
            {d.reasons.length ? (
              <ul className="flex flex-col gap-2.5">
                {d.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2.5">
                    <Activity size={16} className="mt-1 shrink-0 text-link" aria-hidden="true" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-fg2">No measurable signal has been recorded yet.</p>}
          </Block>
          {e.whoCares ? <Block title="Who should care?"><p>{e.whoCares}</p>{e.applications ? <p>{e.applications}</p> : null}</Block> : null}
          <Block title="Limitations">
            <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-fg3">
              {e.limitations.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </Block>
          <Block title="Explore">
            <ul className="flex flex-col gap-3">
              {d.sources.map((s) => (
                <li key={`${s.sourceId}-${s.url}`} className="min-w-0">
                  <ExternalLink href={s.url} className="font-medium text-link hover:underline break-anywhere">
                    {s.primary ? `${s.sourceName} (original)` : `${s.sourceName}: ${s.title}`}
                  </ExternalLink>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 t-meta">
                    <span className="break-anywhere">{s.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</span>
                    {s.points != null && !s.primary ? <><Rule /><span className="t-num">{s.points} points{s.comments ? `, ${s.comments} comments` : ''}</span></> : null}
                  </div>
                </li>
              ))}
            </ul>
            <p className="t-meta mt-4">
              {e.method === 'llm'
                ? `Summary drafted by ${e.model ?? 'a language model'} from the sources above, then checked so that every figure and link appears in them.`
                : 'Summary assembled by quoting and restating the sources above. No language model wrote it.'}
            </p>
          </Block>
        </div>

        <aside className="flex min-w-0 flex-col gap-[var(--gap)]" aria-label="Evidence">
          <Panel title="Confidence">
            <div className="flex items-center justify-between gap-3">
              <Confidence level={d.confidenceLevel} />
              <span className="t-section t-num">{d.confidence}<span className="t-meta"> / 100</span></span>
            </div>
            <ul className="mt-4 flex flex-col gap-2.5">
              {d.credibilityFactors.map((f) => (
                <li key={f.label} className="flex items-start justify-between gap-3 t-meta">
                  <span className="min-w-0"><span className="text-fg">{f.label}</span><br />{f.detail}</span>
                  <span className={`t-num shrink-0 font-medium ${f.points < 0 ? 'text-bad' : 'text-fg'}`}>{f.points > 0 ? '+' : ''}{f.points}</span>
                </li>
              ))}
            </ul>
            <p className="t-meta mt-4">Star counts add nothing to this score.</p>
          </Panel>

          <Panel title="Trend score">
            <div className="mb-4 flex items-baseline gap-2"><span className="t-page t-num">{Math.round(d.scores.total)}</span><span className="t-meta">of 100, weighted</span></div>
            <dl className="flex flex-col gap-3">
              {SCORES.map(([key, label]) => (
                <div key={key}>
                  <dt className="flex items-baseline justify-between gap-3 t-meta">
                    <span>{label}, weight {Math.round(DEFAULT_WEIGHTS[key] * 100)}%</span>
                    <span className="t-num text-fg">{Math.round(d.scores[key])}</span>
                  </dt>
                  <dd className="meter mt-1.5" aria-hidden="true"><span style={{ width: `${Math.round(d.scores[key])}%` }} /></dd>
                </div>
              ))}
            </dl>
          </Panel>

          {d.model ? (
            <Panel title="Model">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 t-meta">
                <div><dt>Publisher</dt><dd className="text-fg break-anywhere">{d.model.vendor ?? 'Not stated'}</dd></div>
                <div><dt>Weights</dt><dd className="text-fg">{d.model.openWeights === true ? 'Downloadable' : d.model.openWeights === false ? 'Not public' : 'Not stated'}</dd></div>
                <div><dt>Licence</dt><dd className="text-fg break-anywhere">{d.model.license ?? 'Not stated'}</dd></div>
                <div><dt>Modalities</dt><dd className="text-fg">{d.model.modalities.length ? d.model.modalities.join(', ') : 'Not stated'}</dd></div>
              </dl>
              <p className="t-meta mt-4">
                {d.model.independentlyTested
                  ? 'The sources describe independent testing.'
                  : 'Capabilities, benchmarks and prices here are the publisher’s statements. No independent test is on record.'}
              </p>
            </Panel>
          ) : null}

          {d.repo ? (
            <Panel title="Repository">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 t-meta">
                <div><dt>Stars</dt><dd className="t-card t-num text-fg">{d.repo.stars != null ? fmtInt(d.repo.stars) : 'n/a'}</dd></div>
                <div><dt>Growth</dt><dd className="t-card t-num text-fg">{growth.value}</dd><dd>{growth.label}</dd></div>
                <div><dt>Forks</dt><dd className="t-num text-fg">{d.repo.forks != null ? fmtInt(d.repo.forks) : 'n/a'}</dd></div>
                <div><dt>Open issues</dt><dd className="t-num text-fg">{d.repo.openIssues != null ? fmtInt(d.repo.openIssues) : 'n/a'}</dd></div>
                <div><dt>Language</dt><dd className="text-fg">{d.repo.language ?? 'Not stated'}</dd></div>
                <div><dt>Licence</dt><dd className="text-fg">{d.repo.license ?? 'None declared'}</dd></div>
                <div><dt>Created</dt><dd className="text-fg">{shortDate(d.repo.createdAt)}</dd></div>
                <div><dt>Last push</dt><dd className="text-fg"><TimeText iso={d.repo.pushedAt} now={now} /></dd></div>
                {d.repo.latestRelease ? <div className="col-span-2"><dt>Latest release</dt><dd className="text-fg break-anywhere">{d.repo.latestRelease.tag}{d.repo.latestRelease.publishedAt ? `, ${shortDate(d.repo.latestRelease.publishedAt)}` : ''}</dd></div> : null}
                {d.repo.contributors != null ? <div><dt>Contributors</dt><dd className="t-num text-fg">{fmtInt(d.repo.contributors)}</dd></div> : null}
              </dl>
              <p className="t-meta mt-4">Read from the GitHub API. Growth is computed from {d.repo.growth.snapshots} {d.repo.growth.snapshots === 1 ? 'snapshot' : 'snapshots'} we recorded; nothing is back-filled.</p>
            </Panel>
          ) : null}

          <Panel title="Verification checks">
            <ul className="flex flex-col gap-3.5">
              {d.evidence.map((ev) => {
                const o = OUTCOME[ev.outcome];
                return (
                  <li key={ev.check} className="flex items-start gap-2.5">
                    <o.Icon size={16} className={`mt-0.5 shrink-0 ${o.className}`} aria-hidden="true" />
                    <div className="min-w-0 t-meta">
                      <div className="text-fg"><span className="font-medium">{CHECK_LABELS[ev.check] ?? ev.check}</span> <span className="text-fg2">({o.word})</span></div>
                      <div className="break-anywhere">{ev.detail}</div>
                    </div>
                  </li>
                );
              })}
              {d.evidence.length === 0 ? <li className="t-meta">No checks have run yet.</li> : null}
            </ul>
          </Panel>

          {d.tags.length ? (
            <Panel title="Tags">
              <ul className="flex flex-wrap gap-1.5">
                {d.tags.map((t) => <li key={t}><Link href={`/discover?q=${encodeURIComponent(t)}`} className="tag hover:text-fg">{t}</Link></li>)}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
