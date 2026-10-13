'use client';

import Link from 'next/link';
import { ArrowUpRight, BookOpen, Check, ChevronLeft, Clapperboard, Copy, Languages, PenLine } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DetailView } from '@/components/discovery/detail';
import { LayerView } from '@/components/learn/layer-switcher';
import { StoryPlayer } from '@/components/learn/story-player';
import { VisualizationView } from '@/components/learn/visualization';
import { Segmented } from '@/components/ui/controls';
import { Confidence, EmptyState, ExternalLink, Notice, PageHeader, Rule } from '@/components/ui/primitives';
import { HAS_BACKEND, loadLanguage, requestTranslation, useAccount, usePrefs } from '@/lib/client/platform';
import { buildDraft, contentOpportunity, draftToText, FORMATS, TONES, type FormatId, type ToneId } from '@/lib/creator/templates';
import { buildExplanation } from '@/lib/explain/build';
import type { LayerId } from '@/lib/explain/model';
import { makeT } from '@/lib/i18n';
import { contentVersion, hasBundledContent, localizeExplanation, subscribeContent } from '@/lib/i18n/content';
import { UI_LANGUAGES, uiLanguage } from '@/lib/i18n/languages';
import { categoryName, type DiscoveryView, type GeneratedRecord, type TrendView } from '@/lib/types';

export type Generated = Record<string, GeneratedRecord>;

/** Fetches the chosen language's bundled text if needed and re-renders when it has arrived. */
export function useBundledLanguage(language: string): number {
  useEffect(() => {
    void loadLanguage(language);
  }, [language]);
  return useSyncExternalStore(subscribeContent, contentVersion, () => 0);
}

/** Translated source text for one discovery, if a cached record exists for this language. */
export function cachedTranslation(generated: Generated, id: string, language: string): { fields: Record<string, string>; provider: string; model: string } | null {
  const record = generated[`translation:discovery:${id}:${language}`];
  if (!record) return null;
  const payload = record.payload as { fields?: Record<string, string> } | Record<string, string>;
  const fields = (payload && typeof payload === 'object' && 'fields' in payload ? payload.fields : payload) as Record<string, string> | undefined;
  return fields && typeof fields === 'object' ? { fields, provider: record.provider, model: record.model } : null;
}

/** A copy of the record with its source text replaced by a stored translation. The original object is untouched. */
export function applyTranslation(d: DiscoveryView, fields: Record<string, string>): DiscoveryView {
  const pick = (key: string, fallback: string) => (typeof fields[key] === 'string' && fields[key].trim() ? fields[key] : fallback);
  return {
    ...d,
    headline: pick('headline', d.headline),
    summary: pick('summary', d.summary),
    editorial: {
      ...d.editorial,
      what: pick('editorial.what', d.editorial.what),
      why: pick('editorial.why', d.editorial.why),
      how: d.editorial.how ? pick('editorial.how', d.editorial.how) : null,
      whoCares: pick('editorial.whoCares', d.editorial.whoCares),
      limitations: d.editorial.limitations.map((l, i) => pick(`limitation.${i}`, l)),
    },
  };
}

/** The article page with the language switcher: translated source text when it exists, and the original on request. */
export function ArticleView({ d, generated, now, backHref }: { d: DiscoveryView; generated: Generated; now: string; backHref?: string }) {
  const { language, translation, status } = useTranslation(d, generated);
  const [sideBySide, setSideBySide] = useState(false);
  const shown = translation ? applyTranslation(d, translation.fields) : d;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
        {translation ? (
          <label htmlFor="side-by-side" className="flex min-h-10 cursor-pointer items-center gap-2 t-small">
            <input id="side-by-side" type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={sideBySide} onChange={(e) => setSideBySide(e.target.checked)} />
            Show the original alongside
          </label>
        ) : null}
        <LanguageSwitcher id="article-language" />
      </div>
      <div className="mb-5 flex flex-col gap-3 empty:hidden">{language === 'en' ? null : status}</div>
      {sideBySide && translation ? (
        <div className="grid gap-10 xl:grid-cols-2">
          <div className="min-w-0"><DetailView d={shown} now={now} backHref={backHref} /></div>
          <div className="min-w-0" lang="en"><h2 className="t-section mb-4">Original (English)</h2><DetailView d={d} now={now} backHref={backHref} /></div>
        </div>
      ) : <DetailView d={shown} now={now} backHref={backHref} />}
    </>
  );
}

export function LanguageSwitcher({ id = 'language' }: { id?: string }) {
  const { prefs, setPrefs } = usePrefs();
  return (
    <div className="flex items-center gap-2">
      <Languages size={17} className="shrink-0 text-fg2" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">Language</label>
      <select id={id} className="field !min-h-10 w-auto" value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value })}>
        {UI_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}{l.native === l.name ? '' : ` (${l.name})`}</option>)}
      </select>
    </div>
  );
}

/**
 * Says exactly what is and is not translated. Fixed explanations can ship in
 * a language; text quoted from sources is only translated by a provider.
 */
export function useTranslation(d: DiscoveryView, generated: Generated) {
  const { prefs } = usePrefs();
  const account = useAccount();
  const language = prefs.language;
  const [requested, setRequested] = useState<Record<string, { fields: Record<string, string>; provider: string; model: string }>>({});
  const [busy, setBusy] = useState(false);
  // Keyed by item and language, so a message never carries over to a different request.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = `${d.id}:${language}`;
  const error = failure?.key === key ? failure.message : '';
  const translation = language === 'en' ? null : requested[`${d.id}:${language}`] ?? cachedTranslation(generated, d.id, language);

  const request = async () => {
    setBusy(true);
    setFailure(null);
    const result = await requestTranslation(d.id, language);
    setBusy(false);
    if (result.ok) setRequested((prev) => ({ ...prev, [`${d.id}:${language}`]: { fields: result.fields, provider: result.provider, model: result.model } }));
    else setFailure({ key, message: result.message });
  };

  const lang = uiLanguage(language);
  let status: ReactNode = null;
  if (language !== 'en' && !translation) {
    const fixed = lang.bundled ? `General explanations and labels are shown in ${lang.name}. ` : `${lang.name} is not bundled with this build. `;
    status = (
      <Notice>
        {fixed}Text taken from this item’s sources is shown in the original English because no {lang.name} translation of it has been stored yet.{' '}
        {!HAS_BACKEND ? 'This page has no server, so it cannot request one.'
          : !account ? null
          : !account.translationAvailable ? 'No translation provider is configured on this server.'
          : !account.signedIn ? <>Translating costs money to run, so it needs an account. <Link href="/account" className="font-medium text-link hover:underline">Sign in</Link> to request one.</>
          : <button type="button" className="btn btn-quiet !min-h-9 !px-2" onClick={request} disabled={busy} aria-busy={busy}>{busy ? 'Translating' : `Translate into ${lang.name}`}</button>}
        {error ? <span className="mt-1 block text-bad" role="alert">{error}</span> : null}
      </Notice>
    );
  } else if (translation) {
    status = <Notice>Source text translated into {lang.name} by {translation.provider} ({translation.model}). Names, numbers, code and links are kept exactly as in the original, which remains the reference.</Notice>;
  }
  return { language, lang, translation, status };
}

export function LearnDetailView({ d, generated, initialMode = 'explain' }: { d: DiscoveryView; generated: Generated; now: string; initialMode?: 'explain' | 'story' }) {
  const { prefs, setPrefs } = usePrefs();
  const { language, translation, status } = useTranslation(d, generated);
  const loaded = useBundledLanguage(language);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaded` changes when a language file arrives
  const t = useMemo(() => makeT(language), [language, loaded]);
  const shown = useMemo(() => (translation ? applyTranslation(d, translation.fields) : d), [d, translation]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const explanation = useMemo(() => localizeExplanation(buildExplanation(shown), language), [shown, language, loaded]);
  const original = useMemo(() => buildExplanation(d), [d]);
  const [showOriginal, setShowOriginal] = useState(false);
  const tEn = useMemo(() => makeT('en'), []);
  const [mode, setMode] = useState<'explain' | 'story'>(initialMode);
  const [step, setStep] = useState(0);
  const layer = prefs.layer as LayerId;

  return (
    <article lang={hasBundledContent(language) ? (language === 'hinglish' ? 'hi-Latn' : language) : 'en'}>
      <Link href={`/d/${d.id}`} className="mb-5 inline-flex min-h-10 items-center gap-1 t-small font-medium text-link hover:underline">
        <ChevronLeft size={16} aria-hidden="true" /> Back to the article
      </Link>
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 t-meta">
          <span className="font-medium text-fg">{explanation.conceptName ?? categoryName(d.category)}</span>
          <Rule />
          <Confidence level={d.confidenceLevel} score={d.confidence} />
        </div>
        <h1 className="t-page break-anywhere">{shown.headline}</h1>
        <p className="t-body mt-2 text-fg2 measure break-anywhere">{shown.summary}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Segmented label="View" options={[{ id: 'explain', name: 'Explanation' }, { id: 'story', name: 'Story Mode' }] as const} value={mode} onChange={setMode} />
          <LanguageSwitcher id="learn-language" />
          {language !== 'en' ? (
            <label htmlFor="learn-original" className="flex min-h-10 cursor-pointer items-center gap-2 t-small">
              <input id="learn-original" type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
              Show the original alongside
            </label>
          ) : null}
          <Link href={`/studio/${d.id}`} className="btn"><PenLine size={15} aria-hidden="true" /> Create content</Link>
        </div>
      </header>

      <div className="mb-6 flex flex-col gap-3 empty:hidden">{status}</div>

      {mode === 'story' ? (
        <StoryPlayer explanation={explanation} t={t} />
      ) : (
        // One column: the diagram gets the full width so it can lay out left to right.
        <div className="flex flex-col gap-10">
          <section aria-label="Explanation" className="min-w-0 max-w-3xl">
            <LayerView explanation={explanation} layerId={layer} onLayerChange={(id: LayerId) => setPrefs({ layer: id })} t={t} />
            {showOriginal && language !== 'en' ? (
              <div className="mt-8 border-t border-sepsoft pt-6" lang="en" dir="ltr">
                <h2 className="t-card mb-3">Original (English)</h2>
                <LayerView explanation={original} layerId={layer} onLayerChange={(id: LayerId) => setPrefs({ layer: id })} t={tEn} />
              </div>
            ) : null}
          </section>
          <section aria-label="Diagram" className="min-w-0">
            {explanation.visualization ? (
              <VisualizationView visualization={explanation.visualization} stepIndex={step} onStepChange={setStep} t={t} />
            ) : (
              <EmptyState title="No diagram for this one">
                Its sources do not describe a mechanism, and it does not match a kind of system we have a general diagram for. Nothing is drawn rather than guessed.
              </EmptyState>
            )}
          </section>
        </div>
      )}

      <footer className="mt-10 border-t border-sepsoft pt-5">
        <h2 className="t-card mb-2">Sources</h2>
        <ul className="flex flex-col gap-1.5 t-small">
          {d.sources.map((s) => (
            <li key={`${s.sourceId}-${s.url}`} className="break-anywhere">
              <ExternalLink href={s.url} className="text-link hover:underline">{s.primary ? `${s.sourceName} (original)` : `${s.sourceName}: ${s.title}`}</ExternalLink>
            </li>
          ))}
        </ul>
        <p className="t-meta mt-3 measure">
          This explanation was assembled from the record above and a fixed library of general explanations. No language model wrote it. Diagrams marked illustrative show how this kind of system usually works, not this project’s confirmed design.
        </p>
      </footer>
    </article>
  );
}

function CopyTextButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2200);
  };
  return (
    <button type="button" className="btn" onClick={copy}>
      {state === 'copied' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span aria-live="polite">{state === 'copied' ? 'Draft copied' : state === 'failed' ? 'Select the text to copy' : 'Copy draft'}</span>
    </button>
  );
}

export function StudioView({ d }: { d: DiscoveryView }) {
  const [format, setFormat] = useState<FormatId>('script-60');
  const [tone, setTone] = useState<ToneId>('educational');
  const explanation = useMemo(() => buildExplanation(d), [d]);
  const draft = useMemo(() => buildDraft(d, explanation, format, tone), [d, explanation, format, tone]);
  const text = useMemo(() => draftToText(draft), [draft]);
  const usable = d.status === 'verified';
  return (
    <article>
      <Link href={`/d/${d.id}`} className="mb-5 inline-flex min-h-10 items-center gap-1 t-small font-medium text-link hover:underline">
        <ChevronLeft size={16} aria-hidden="true" /> Back to the article
      </Link>
      <PageHeader title="Creator Studio" lede={d.headline} />
      {!usable ? <div className="mb-6"><Notice tone="warn">This item has not passed verification. Drafts are still available, but treat every statement in them as unconfirmed and read the cautions before publishing anything.</Notice></div> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div>
          <label htmlFor="studio-format" className="t-meta mb-1.5 block">Format</label>
          <select id="studio-format" className="field" value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="studio-tone" className="t-meta mb-1.5 block">Tone</label>
          <select id="studio-tone" className="field" value={tone} onChange={(e) => setTone(e.target.value as ToneId)}>
            {TONES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Draft" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="t-section break-anywhere">{draft.title}</h2>
            <CopyTextButton text={text} />
          </div>
          <div className="card flex flex-col gap-5">
            {draft.sections.map((s) => (
              <section key={s.label}>
                <h3 className="t-meta mb-1 font-medium text-fg">{s.label}</h3>
                <p className="t-body measure whitespace-pre-line break-anywhere">{s.text}</p>
              </section>
            ))}
          </div>
          <p className="t-meta mt-3 measure">
            Assembled from the verified record: every sentence restates a stored fact or is fixed scaffolding such as labels and timings. Tone changes the framing words only. It is a starting draft in English; no language model wrote it, and no video is rendered.
          </p>
        </section>
        <aside className="flex min-w-0 flex-col gap-[var(--gap)]" aria-label="Sources and cautions">
          <section className="card">
            <h2 className="t-card mb-3">Do not state as fact</h2>
            {draft.cautions.length ? (
              <ul className="flex list-disc flex-col gap-2 pl-5 t-small marker:text-fg3">{draft.cautions.map((c) => <li key={c} className="break-anywhere">{c}</li>)}</ul>
            ) : <p className="t-small text-fg2">No open checks on this record.</p>}
          </section>
          <section className="card">
            <h2 className="t-card mb-3">Sources to cite</h2>
            <ul className="flex flex-col gap-2 t-small">
              {draft.sources.map((s) => <li key={s.url} className="break-anywhere"><ExternalLink href={s.url} className="text-link hover:underline">{s.name}</ExternalLink></li>)}
            </ul>
          </section>
          <Link href={`/learn/${d.id}`} className="btn"><BookOpen size={15} aria-hidden="true" /> Understand how it works</Link>
        </aside>
      </div>
    </article>
  );
}

export function ContentRadarList({ items }: { items: DiscoveryView[] }) {
  return (
    <ul className="group-list">
      {items.map((d) => {
        const o = contentOpportunity(d);
        return (
          <li key={d.id} className="row grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <h3 className="t-card break-anywhere"><Link href={`/d/${d.id}`} className="hover:underline">{d.headline}</Link></h3>
              <p className="t-small mt-1 text-fg2 clamp-2 break-anywhere">{d.summary}</p>
              <ul className="mt-2 flex flex-col gap-1 t-meta text-fg">{o.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 md:flex-col md:items-end md:justify-center">
              <p className="t-meta md:text-right"><span className="t-section t-num text-fg">{Math.round(o.score)}</span> story potential</p>
              <Link href={`/studio/${d.id}`} className="btn btn-primary"><Clapperboard size={15} aria-hidden="true" /> Open in Studio</Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_COPY: Record<TrendView['status'], { name: string; note: string }> = {
  accelerating: { name: 'Accelerating', note: 'At least half as many items again as a week earlier.' },
  emerging: { name: 'Emerging', note: 'Tracked for under a week and growing.' },
  established: { name: 'Established', note: 'Steady volume.' },
  declining: { name: 'Declining', note: 'Down by 30% or more.' },
  new: { name: 'Newly tracked', note: 'One day of history. No direction can be stated yet.' },
};
const STATUS_ORDER: TrendView['status'][] = ['accelerating', 'emerging', 'new', 'established', 'declining'];

export function TrendingView({ trends, items }: { trends: TrendView[]; items: DiscoveryView[] }) {
  const byId = useMemo(() => new Map(items.map((d) => [d.id, d])), [items]);
  const [kind, setKind] = useState<'all' | TrendView['kind']>('all');
  const shown = trends.filter((t) => kind === 'all' || t.kind === kind);
  return (
    <>
      <PageHeader title="Trending" lede="Topics, not single stories. Each one is counted from verified items first seen in the last seven days and compared with our own earlier snapshots." />
      <div className="mb-6 scroll-x max-w-full">
        <Segmented label="Topic type" options={[{ id: 'all', name: 'All' }, { id: 'tag', name: 'Topics' }, { id: 'industry', name: 'Industries' }, { id: 'category', name: 'Categories' }] as const} value={kind} onChange={setKind} />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No trends recorded yet">Trend analysis runs daily and needs at least three verified items on a topic within a week.</EmptyState>
      ) : STATUS_ORDER.map((status) => {
        const group = shown.filter((t) => t.status === status);
        if (!group.length) return null;
        return (
          <section key={status} className="mb-10">
            <h2 className="t-section">{STATUS_COPY[status].name}</h2>
            <p className="t-meta mb-3 mt-1">{STATUS_COPY[status].note}</p>
            <ul className="group-list">
              {group.slice(0, 12).map((t) => (
                <li key={`${t.kind}:${t.topic}`} className="row grid gap-x-8 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <h3 className="t-card break-anywhere">
                      <Link href={t.kind === 'industry' ? `/industries?industry=${t.topic}` : t.kind === 'category' ? `/discover?category=${t.topic}` : `/discover?q=${encodeURIComponent(t.topic)}`} className="hover:underline">{t.name}</Link>
                    </h3>
                    <ul className="mt-1.5 flex flex-col gap-1 t-meta">{t.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <ul className="mt-2 flex flex-col gap-1 t-small">
                      {t.topIds.slice(0, 3).map((id) => byId.get(id)).filter((d): d is DiscoveryView => Boolean(d)).map((d) => (
                        <li key={d.id} className="break-anywhere"><Link href={`/d/${d.id}`} className="text-link hover:underline">{d.headline}</Link></li>
                      ))}
                    </ul>
                  </div>
                  <dl className="flex gap-6 md:flex-col md:items-end md:gap-1">
                    <div className="md:text-right"><dt className="t-meta">Trend score</dt><dd className="t-section t-num">{Math.round(t.score)}</dd></div>
                    <div className="md:text-right"><dt className="t-meta">Items, 7 days</dt><dd className="t-card t-num">{t.items}{t.previousItems != null ? <span className="t-meta"> was {t.previousItems}</span> : null}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="t-meta measure">Trend score combines the average momentum and confidence of a topic’s items with how many there are and how many independent sources mention them. It measures attention backed by evidence, not quality or truth.</p>
    </>
  );
}

export function OpenOriginal({ href }: { href: string }) {
  return <ExternalLink href={href} className="btn">Open original <ArrowUpRight size={15} aria-hidden="true" /></ExternalLink>;
}
