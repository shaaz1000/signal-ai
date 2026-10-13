'use client';

import { Check, Link2, Monitor, Moon, RefreshCw, Search, Sun } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, usePrefs, useRefresh } from '@/lib/client/platform';
import type { Prefs } from '@/lib/prefs';

const THEMES: { id: Prefs['theme']; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'Match system', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

/** Cycles system, light, dark. The label always names the current setting. */
export function ThemeToggle() {
  const { prefs, setPrefs } = usePrefs();
  const index = THEMES.findIndex((t) => t.id === prefs.theme);
  const current = THEMES[index] ?? THEMES[0];
  const next = THEMES[(index + 1) % THEMES.length];
  return (
    <button type="button" className="icon-btn" onClick={() => setPrefs({ theme: next.id })} aria-label={`Theme: ${current.label}. Switch to ${next.label}`} title={`Theme: ${current.label}`}>
      <current.Icon size={18} aria-hidden="true" />
    </button>
  );
}

export function RefreshButton({ label = 'Refresh' }: { label?: string }) {
  const { refresh, refreshing } = useRefresh();
  return (
    <button type="button" className="btn" onClick={refresh} disabled={refreshing} aria-busy={refreshing}>
      <RefreshCw size={15} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
      {refreshing ? 'Refreshing' : label}
    </button>
  );
}

export function CopyLinkButton({ url }: { url?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const value = url ?? (typeof window !== 'undefined' ? window.location.href : '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? window.location.href);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1800);
    } catch {
      // Clipboard access can be refused; show the link so it can be copied by hand.
      setState('manual');
    }
  };
  useEffect(() => {
    if (state === 'manual') inputRef.current?.select();
  }, [state]);
  if (state === 'manual') {
    return <input ref={inputRef} readOnly value={value} aria-label="Link to this page" className="field max-w-xs !min-h-10 text-sm" onBlur={() => setState('idle')} />;
  }
  return (
    <button type="button" className="btn" onClick={copy}>
      {state === 'copied' ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
      <span aria-live="polite">{state === 'copied' ? 'Link copied' : 'Copy link'}</span>
    </button>
  );
}

/** Search box in the navigation: sends the term to Discover. */
export function QuickSearch({ id }: { id: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    navigate(q ? `/discover?q=${encodeURIComponent(q)}` : '/discover');
    setValue('');
  };
  return (
    <form role="search" onSubmit={submit} className="relative">
      <label htmlFor={id} className="sr-only">Search all discoveries</label>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg3" aria-hidden="true" />
      <input id={id} type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Search" autoComplete="off" enterKeyHint="search" className="field !min-h-10 !pl-9 text-[0.9375rem]" />
    </form>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { id: T; name: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}
