'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { StringKey, T } from '@/lib/i18n';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribeReduced(onChange: () => void): () => void {
  if (!canMatch()) return () => {};
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** The system "reduce motion" setting. False on the server, so nothing that moves may start before hydration. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => canMatch() && window.matchMedia(REDUCED_QUERY).matches, () => false);
}

/** Content width of an element in whole CSS pixels; null until it has been measured in the browser. */
export function useElementWidth<E extends HTMLElement>(): [RefObject<E | null>, number | null] {
  const ref = useRef<E | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.clientWidth);
      if (next > 0) setWidth(next);
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    const timer = window.setTimeout(measure, 0);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, []);
  return [ref, width];
}

/** Looks up a string whose key is built at run time; `fallback` is used when no such key exists. */
export function tr(t: T, key: string, fallback: string): string {
  const out = t(key as StringKey);
  return out === key ? fallback : out;
}
