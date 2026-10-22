'use client';

import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { RefreshButton, Segmented } from '@/components/ui/controls';
import { LanguageSwitcher } from '@/components/views/learn';
import { EmptyState, ExternalLink, PageHeader, Rule } from '@/components/ui/primitives';
import { useBookmarks, usePrefs } from '@/lib/client/platform';
import { DEFAULT_COLLECTION } from '@/lib/client/bookmarks';
import { WINDOWS } from '@/lib/feed/query';
import type { Prefs } from '@/lib/prefs';
import { CATEGORIES, categoryName, SOURCE_GROUPS, type StatusView } from '@/lib/types';
import { dateTime, relativeTime } from '@/lib/utils/time';

export function BookmarksView({ now }: { now: string }) {
  const { state, store } = useBookmarks();
  const [active, setActive] = useState<string>('all');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const shown = active === 'all' ? state.items : state.items.filter((i) => i.collection === active);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the collection a name.');
    if (!store.addCollection(name)) return setError('A collection with that name already exists.');
    setActive(name.trim());
    setName('');
    setError('');
  };

  return (
    <>
      <PageHeader title="Saved" lede={store.describe()} />
      <div className="mb-6 flex flex-col gap-4">
        <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
          <div role="group" aria-label="Collection" className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            <button type="button" className="chip" aria-pressed={active === 'all'} onClick={() => setActive('all')}>All <span className="t-num opacity-70">{state.items.length}</span></button>
            {state.collections.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={active === c} onClick={() => setActive(c)}>
                {c} <span className="t-num opacity-70">{state.items.filter((i) => i.collection === c).length}</span>
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={add} className="flex flex-wrap items-start gap-2.5">
          <div className="min-w-0 flex-[1_1_220px] sm:max-w-xs">
            <label htmlFor="new-collection" className="sr-only">New collection name</label>
            <input id="new-collection" className="field" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="New collection" maxLength={60} aria-describedby={error ? 'collection-error' : undefined} aria-invalid={Boolean(error)} />
            {error ? <p id="collection-error" className="t-meta mt-1.5 !text-bad" role="alert">{error}</p> : null}
          </div>
          <button type="submit" className="btn min-h-11">Add collection</button>
          {active !== 'all' && active !== DEFAULT_COLLECTION ? (
            <button type="button" className="btn btn-quiet min-h-11" onClick={() => { store.removeCollection(active); setActive('all'); }}>
              Delete “{active}”
            </button>
          ) : null}
        </form>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={state.items.length ? 'This collection is empty' : 'Nothing saved yet'} action={<Link href="/discover" className="btn btn-primary">Browse discoveries</Link>}>
          Use the bookmark button on any discovery to keep it here.
        </EmptyState>
      ) : (
        <ul className="group-list">
          {shown.map((item) => (
            <li key={item.id} className="row flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 flex-[1_1_320px]">
                <h2 className="t-card break-anywhere"><Link href={`/d/${item.id}`} className="hover:underline">{item.title}</Link></h2>
                <p className="t-small mt-1 text-fg2 clamp-2 break-anywhere">{item.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 t-meta">
                  <span>{categoryName(item.category)}</span>
                  <Rule />
                  <span>Saved {relativeTime(item.savedAt, now)}</span>
                  <Rule />
                  <ExternalLink href={item.url} className="text-link hover:underline">Open original</ExternalLink>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={`move-${item.id}`} className="sr-only">Collection for {item.title}</label>
                <select id={`move-${item.id}`} className="field !min-h-10 w-auto max-w-[180px]" value={item.collection} onChange={(e) => store.move(item.id, e.target.value)}>
                  {state.collections.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" className="icon-btn" aria-label={`Remove ${item.title} from saved`} onClick={() => store.remove(item.id)}>
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="row flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span className="t-small">{label}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
    </label>
  );
}

function Setting({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="t-section">{title}</h2>
      {hint ? <p className="t-meta mt-1 mb-3 measure">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

const THEME_OPTIONS = [{ id: 'system', name: 'System' }, { id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }] as const;
const DENSITY_OPTIONS = [{ id: 'comfortable', name: 'Comfortable' }, { id: 'compact', name: 'Compact' }] as const;
const REFRESH_OPTIONS = [{ id: '0', name: 'Off' }, { id: '5', name: '5 min' }, { id: '15', name: '15 min' }, { id: '60', name: 'Hourly' }] as const;

export function SettingsView({ platform }: { platform: 'web' | 'artifact' }) {
  const { prefs, setPrefs } = usePrefs();
  const toggleIn = <K extends 'hiddenCategories' | 'hiddenGroups'>(key: K, id: Prefs[K][number], show: boolean) => {
    const list = prefs[key] as string[];
    setPrefs({ [key]: show ? list.filter((x) => x !== id) : [...new Set([...list, id])] } as Partial<Prefs>);
  };
  return (
    <>
      <PageHeader title="Settings" lede={platform === 'web' ? 'Stored in a cookie in this browser so pages render with your choices straight away.' : 'Stored in this browser only.'} />
      <Setting title="Appearance">
        <div className="flex flex-col gap-3">
          <div className="scroll-x max-w-full"><Segmented label="Theme" options={THEME_OPTIONS} value={prefs.theme} onChange={(theme) => setPrefs({ theme })} /></div>
          <div className="scroll-x max-w-full"><Segmented label="Content density" options={DENSITY_OPTIONS} value={prefs.density} onChange={(density) => setPrefs({ density })} /></div>
        </div>
      </Setting>
      <Setting title="Language" hint="Used for explanations, Story Mode and diagram labels. English, Hindi and Hinglish ship with the app; text taken from sources stays in its original language unless a translation has been stored.">
        <LanguageSwitcher id="settings-language" />
      </Setting>
      <Setting title="Topics" hint="Switch a topic off to remove it from Today and from unfiltered feeds. Choosing it as a filter still shows it.">
        <div className="group-list">
          {CATEGORIES.map((c) => <Toggle key={c.id} id={`topic-${c.id}`} label={c.name} checked={!prefs.hiddenCategories.includes(c.id)} onChange={(v) => toggleIn('hiddenCategories', c.id, v)} />)}
        </div>
      </Setting>
      <Setting title="Sources" hint="Hides discoveries whose original source belongs to a group you switch off.">
        <div className="group-list">
          {SOURCE_GROUPS.map((g) => <Toggle key={g.id} id={`group-${g.id}`} label={g.name} checked={!prefs.hiddenGroups.includes(g.id)} onChange={(v) => toggleIn('hiddenGroups', g.id, v)} />)}
        </div>
      </Setting>
      <Setting title="Default time window" hint="Applied to Discover and the other feeds until you pick a different window there. Uses the publication date, or the creation date for repositories.">
        <div className="scroll-x max-w-full"><Segmented label="Default time window" options={WINDOWS} value={prefs.window} onChange={(window) => setPrefs({ window })} /></div>
      </Setting>
      <Setting
        title="Refresh"
        hint={platform === 'web'
          ? 'Reloads the page data while this tab is visible. New data only appears after the pipeline runs, which is scheduled hourly.'
          : 'Reloads the published data file while this tab is visible. The data only changes when a new run is published.'}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="scroll-x max-w-full">
            <Segmented label="Automatic refresh" options={REFRESH_OPTIONS} value={String(prefs.autoRefreshMinutes) as '0'} onChange={(v) => setPrefs({ autoRefreshMinutes: Number(v) as Prefs['autoRefreshMinutes'] })} />
          </div>
          <RefreshButton label="Refresh now" />
        </div>
      </Setting>
      <Setting title="Notifications">
        <p className="t-small text-fg2 measure">Not available. Notifications need accounts and a delivery service, neither of which is part of this release.</p>
      </Setting>
    </>
  );
}

export function StatusPanel({ status, now }: { status: StatusView | null; now: string }) {
  if (!status) return null;
  const jobs = [
    ['Discovery', status.lastIngestion], ['Verification', status.lastVerification], ['Ranking', status.lastRanking], ['Curation', status.lastCuration],
  ] as const;
  const providers = status.lastIngestion?.providers ?? [];
  return (
    <>
      <section className="mb-9">
        <h2 className="t-section mb-3">Jobs</h2>
        <ul className="group-list">
          {jobs.map(([label, job]) => (
            <li key={label} className="row flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <span className="t-small font-medium">{label}</span>
              <span className="t-meta">
                {job ? <>Last successful run {dateTime(job.finishedAt)} ({relativeTime(job.finishedAt, now)}){job.status === 'degraded' ? ', with reduced coverage' : ''}</> : 'Has not run yet'}
              </span>
            </li>
          ))}
          {status.storage !== 'snapshot' ? (
            <li className="row flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
              <span className="t-small font-medium">Next scheduled discovery</span>
              <span className="t-meta">{dateTime(status.nextScheduledIngestion)}, if the scheduler is running</span>
            </li>
          ) : null}
        </ul>
      </section>
      <section className="mb-9">
        <h2 className="t-section mb-1">Sources in the last discovery run</h2>
        <p className="t-meta mb-3">Accepted means the item was on topic and passed validation.</p>
        {providers.length === 0 ? <p className="t-small text-fg2">No run has been recorded.</p> : (
          <div className="group-list scroll-x" role="region" aria-label="Sources in the last discovery run" tabIndex={0}>
            <table className="w-full min-w-[520px] text-left t-small">
              <thead>
                <tr className="t-meta">
                  <th scope="col" className="row font-medium">Source</th>
                  <th scope="col" className="row font-medium">Result</th>
                  <th scope="col" className="row text-right font-medium">Fetched</th>
                  <th scope="col" className="row text-right font-medium">Accepted</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.source} className="border-t border-sepsoft">
                    <th scope="row" className="row font-medium">{p.name}</th>
                    <td className="row">
                      <span className={p.status === 'ok' ? 'text-good' : p.status === 'failed' ? 'text-bad' : 'text-fg2'}>
                        {p.status === 'ok' ? 'Responded' : p.status === 'failed' ? 'Failed' : 'Skipped'}
                      </span>
                      {p.error ? <span className="t-meta block break-anywhere">{p.error}</span> : null}
                    </td>
                    <td className="row t-num text-right">{p.fetched}</td>
                    <td className="row t-num text-right">{p.accepted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2 className="t-section mb-3">Records</h2>
        <dl className="grid grid-cols-2 gap-[var(--gap)] sm:grid-cols-4">
          {([['Active', status.counts.total], ['Verified', status.counts.verified], ['Unverified', status.counts.unverified], ['New in 7 days', status.counts.last7d]] as const).map(([label, n]) => (
            <div key={label} className="card"><dt className="t-meta">{label}</dt><dd className="t-page t-num mt-1">{n}</dd></div>
          ))}
        </dl>
      </section>
    </>
  );
}
