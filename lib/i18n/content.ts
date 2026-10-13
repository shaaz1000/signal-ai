/**
 * Bundled translations of the fixed, hand-written content: the concept
 * library, diagram labels and scene scaffolding. Keyed by the English source
 * string, so adding a language is adding one map, and a missing entry simply
 * stays in English. Text that comes from a discovery's sources is NOT covered
 * here; that is translated by a provider and cached, or shown in the original.
 */
import type { Explanation } from '@/lib/explain/model';

const CONTENT: Record<string, Record<string, string>> = {};

// Languages are loaded on demand, so views subscribe and re-render when one arrives.
let version = 0;
const listeners = new Set<() => void>();
export const subscribeContent = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const contentVersion = () => version;

export function registerContent(language: string, map: Record<string, string>): void {
  CONTENT[language] = { ...(CONTENT[language] ?? {}), ...map };
  version++;
  listeners.forEach((l) => l());
}
export const hasBundledContent = (language: string): boolean => language === 'en' || Boolean(CONTENT[language]);

/** Translates one fixed string, or returns it unchanged. */
export function tc(language: string, english: string): string {
  return CONTENT[language]?.[english] ?? english;
}

/**
 * Returns a copy with concept-library text in the chosen language. Evidence
 * paragraphs and narration taken from sources are left exactly as they are.
 */
export function localizeExplanation(e: Explanation, language: string): Explanation {
  if (language === 'en' || !CONTENT[language]) return e;
  return mapFixedText(e, (s) => tc(language, s));
}

/** Every fixed string an explanation contains, i.e. exactly what a bundled language has to cover. */
export function fixedTextOf(e: Explanation): string[] {
  const seen = new Set<string>();
  mapFixedText(e, (s) => {
    seen.add(s);
    return s;
  });
  return [...seen];
}

function mapFixedText(e: Explanation, t: (s: string) => string): Explanation {
  return {
    ...e,
    conceptName: e.conceptName ? t(e.conceptName) : null,
    layers: e.layers.map((l) => ({ ...l, concept: l.concept.map(t), caveat: l.caveat ? t(l.caveat) : undefined })),
    visualization: e.visualization && {
      ...e.visualization,
      title: t(e.visualization.title),
      nodes: e.visualization.nodes.map((n) => ({ ...n, label: t(n.label), detail: n.detail ? t(n.detail) : undefined })),
      edges: e.visualization.edges.map((x) => ({ ...x, label: x.label ? t(x.label) : undefined })),
      columns: e.visualization.columns.map((c) => ({ title: t(c.title), points: c.points.map(t) })),
      steps: e.visualization.steps.map((s) => ({ ...s, title: t(s.title), description: t(s.description) })),
      textAlternative: t(e.visualization.textAlternative),
    },
    scenes: e.scenes.map((s) => ({ ...s, onScreen: t(s.onScreen), narration: s.illustrative && s.evidenceRefs.length === 0 ? t(s.narration) : s.narration })),
  };
}
