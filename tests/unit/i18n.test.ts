import { describe, expect, it } from 'vitest';
import { registerBundled } from '@/lib/i18n/bundled';
import { buildExplanation } from '@/lib/explain/build';
import { CONCEPTS } from '@/lib/explain/concepts';
import { ExplanationSchema } from '@/lib/explain/schema';
import { HI_CONTENT, HI_INTERFACE } from '@/lib/i18n/bundled.hi';
import { HINGLISH_CONTENT, HINGLISH_INTERFACE } from '@/lib/i18n/bundled.hinglish';
import { hasBundledContent, localizeExplanation } from '@/lib/i18n/content';
import { hasDictionary, makeT, type Dictionary } from '@/lib/i18n/index';
import { conceptStrings, interfaceStrings, NAME_STRINGS } from '@/lib/i18n/source-strings';
import type { DiscoveryView } from '@/lib/types';

// Languages load on demand in the product; the tests register both up front.
registerBundled('hi', { ui: HI_INTERFACE as Record<string, string>, content: HI_CONTENT });
registerBundled('hinglish', { ui: HINGLISH_INTERFACE as Record<string, string>, content: HINGLISH_CONTENT });

const DEVANAGARI = /[ऀ-ॿ]/;

/** Latin-script terms that must survive translation unchanged wherever the English source uses them. */
const TERMS = ['API', 'WebAssembly', 'WebGL', 'WebGPU', 'MCP', 'JSON', 'GitHub', 'U-Net', 'CPU', 'TV', 'X-ray', '3D'];

/**
 * Sources that are a single technical term or proper noun, which Hinglish
 * speakers say in English. Only these may equal their English source.
 */
const HINGLISH_SAME_AS_ENGLISH = new Set([
  'Limitations', 'Medical image', 'AI agents', 'Plan', 'Response', 'Retrieval-augmented generation', 'Documents', 'Embedding index',
  'Language model', 'Text prompt', 'Text encoder', 'Random noise', 'Speech AI', 'Sound features', 'Recognition model', 'Text',
  'Synthesis model', 'Sensors', 'Perception', 'Motors', 'Emulation', 'Streaming', 'Training data', 'Training', 'Model weights',
  'Inference', 'Hypothesis', 'Experiments', 'Peer review', 'Independent replication', 'Request',
  // Interface labels: single terms, control names, and labels made only of such terms.
  'Story Mode', 'Original', 'Steps', 'Step', 'Scenes', 'Illustrative', 'illustrative', 'active', 'Input', 'Output', 'Model', 'Tool', 'Storage',
  'Feedback', 'Retry', 'Approval', 'Play', 'Pause', 'Replay', 'Transcript', 'Input (simulated)', 'Output (simulated)', 'Scene {n}: {name}',
]);

interface Bundle {
  language: string;
  content: Record<string, string>;
  dictionary: Dictionary;
  sameAsEnglish: Set<string>;
  /** Terms this language may legitimately write in its own script. */
  termExceptions: string[];
}

const BUNDLES: Bundle[] = [
  { language: 'hi', content: HI_CONTENT, dictionary: HI_INTERFACE, sameAsEnglish: new Set(), termExceptions: ['X-ray'] },
  { language: 'hinglish', content: HINGLISH_CONTENT, dictionary: HINGLISH_INTERFACE, sameAsEnglish: HINGLISH_SAME_AS_ENGLISH, termExceptions: [] },
];

/** A record with no evidence at all, so everything the builder emits is fixed text. Copied from lib/i18n/source-strings.ts. */
function emptyView(conceptId: string): DiscoveryView {
  return {
    id: '000000000000', kind: 'repository', title: '', headline: 'x', summary: '', category: 'ai-tools', tags: [], claimType: 'project_release', executionMode: null,
    canonicalUrl: 'https://example.com', author: null, authorVerified: false, publishedAt: null, firstDiscoveredAt: '2026-01-01T00:00:00.000Z', lastVerifiedAt: null, lastActivityAt: null,
    status: 'verified', confidence: 0, confidenceLevel: 'medium', scores: { total: 0, novelty: 0, momentum: 0, significance: 0, credibility: 0, usefulness: 0, freshness: 0, gem: 0 },
    reasons: [], credibilityFactors: [], evidence: [], sources: [],
    editorial: { what: '', why: '', how: null, whoCares: '', limitations: [], applications: null, method: 'extractive', model: null },
    repo: null, industries: [], evidenceStage: null, conceptId, model: null, flags: [], fixture: false,
  };
}

const contentSources = (): string[] => [...new Set([...conceptStrings(), ...NAME_STRINGS])];

/** Every [english, translation] pair of a bundle that has a translation, content and interface together. */
function pairs(b: Bundle): [string, string][] {
  const out: [string, string][] = [];
  for (const en of contentSources()) if (en in b.content) out.push([en, b.content[en]]);
  for (const [key, en] of Object.entries(interfaceStrings())) {
    const value = (b.dictionary as Record<string, string | undefined>)[key];
    if (value !== undefined) out.push([en, value]);
  }
  return out;
}

const usesTerm = (english: string, term: string): boolean => new RegExp(`(?<![A-Za-z0-9])${term.replace(/[-]/g, '\\-')}`).test(english);
const show = (items: string[]): string => `${items.length} problem(s):\n${items.slice(0, 40).join('\n')}`;

describe.each(BUNDLES)('bundled language $language', (b) => {
  it('is registered', () => {
    expect(hasDictionary(b.language)).toBe(true);
    expect(hasBundledContent(b.language)).toBe(true);
  });

  it('covers every concept-library and name string', () => {
    const missing = contentSources().filter((en) => !(en in b.content));
    expect(missing, `missing content translations, ${show(missing)}`).toEqual([]);
  });

  it('covers every interface key', () => {
    const missing = Object.keys(interfaceStrings()).filter((key) => !(key in b.dictionary));
    expect(missing, `missing interface translations, ${show(missing)}`).toEqual([]);
  });

  it('has no stale content keys that match no English source', () => {
    const known = new Set(contentSources());
    const stale = Object.keys(b.content).filter((en) => !known.has(en));
    expect(stale, `stale keys, ${show(stale)}`).toEqual([]);
  });

  it('has no empty value', () => {
    const empty = pairs(b).filter(([, value]) => value.trim() === '').map(([en]) => en);
    expect(empty, show(empty)).toEqual([]);
  });

  it('never equals the English source, except for allow-listed single terms', () => {
    const same = pairs(b).filter(([en, value]) => en === value && !b.sameAsEnglish.has(en)).map(([en]) => en);
    expect(same, `untranslated, ${show(same)}`).toEqual([]);
  });

  it('keeps every {placeholder} of an interface string', () => {
    const broken: string[] = [];
    for (const [key, en] of Object.entries(interfaceStrings())) {
      const value = (b.dictionary as Record<string, string | undefined>)[key] ?? '';
      const sorted = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      if (sorted(en).join() !== sorted(value).join()) broken.push(`${key}: ${value}`);
    }
    expect(broken, show(broken)).toEqual([]);
  });

  it('keeps numbers and Latin-script technical terms unchanged', () => {
    const broken: string[] = [];
    for (const [en, value] of pairs(b)) {
      for (const number of en.match(/\d+(?:[.,]\d+)*/g) ?? []) if (!value.includes(number)) broken.push(`number ${number} lost: ${en}`);
      for (const term of TERMS) {
        if (b.termExceptions.includes(term)) continue;
        if (usesTerm(en, term) && !value.includes(term)) broken.push(`term ${term} lost: ${en}`);
      }
    }
    expect(broken, show(broken)).toEqual([]);
  });

  it('uses the right script', () => {
    const wrong = pairs(b)
      .filter(([, value]) => (b.language === 'hi' ? !DEVANAGARI.test(value) : DEVANAGARI.test(value)))
      .map(([en, value]) => `${en} -> ${value}`);
    expect(wrong, show(wrong)).toEqual([]);
  });

  it('contains no angle brackets', () => {
    const bad = pairs(b).filter(([, value]) => /[<>]/.test(value)).map(([en]) => en);
    expect(bad, show(bad)).toEqual([]);
  });

  it('localises concept text without touching ids, structure or evidence links', () => {
    for (const concept of CONCEPTS) {
      const english = buildExplanation(emptyView(concept.id));
      const local = localizeExplanation(english, b.language);

      expect(local.discoveryId).toBe(english.discoveryId);
      expect(local.version).toBe(english.version);
      expect(local.layers.map((l) => l.id)).toEqual(english.layers.map((l) => l.id));
      expect(local.scenes.map((s) => s.id)).toEqual(english.scenes.map((s) => s.id));

      const changed = english.layers.some((layer, i) => layer.concept.length > 0 && layer.concept.every((p, j) => local.layers[i].concept[j] !== p));
      expect(changed, `${concept.id}: concept paragraphs were not translated`).toBe(true);
      for (const [i, layer] of english.layers.entries()) expect(local.layers[i].concept).toHaveLength(layer.concept.length);

      if (english.visualization && local.visualization) {
        expect(local.visualization.id).toBe(english.visualization.id);
        expect(local.visualization.diagramType).toBe(english.visualization.diagramType);
        expect(local.visualization.nodes.map((n) => n.id)).toEqual(english.visualization.nodes.map((n) => n.id));
        expect(local.visualization.steps.map((s) => s.id)).toEqual(english.visualization.steps.map((s) => s.id));
        expect(local.visualization.steps.map((s) => s.focus)).toEqual(english.visualization.steps.map((s) => s.focus));
        expect(local.visualization.edges.map((e) => [e.from, e.to, e.kind])).toEqual(english.visualization.edges.map((e) => [e.from, e.to, e.kind]));
      } else {
        expect(local.visualization).toEqual(english.visualization);
      }

      // The translated explanation must still satisfy the same contract (plain text, length ceilings).
      const parsed = ExplanationSchema.safeParse(local);
      expect(parsed.success, `${concept.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 5))}`).toBe(true);
    }
  });
});

describe('interface translation', () => {
  it('fills placeholders in Hindi', () => {
    const text = makeT('hi')('learn.step', { n: 2, total: 5 });
    expect(text).toContain('2');
    expect(text).toContain('5');
    expect(DEVANAGARI.test(text)).toBe(true);
  });

  it('fills placeholders in Hinglish', () => {
    const text = makeT('hinglish')('learn.step', { n: 2, total: 5 });
    expect(text).toContain('2');
    expect(text).toContain('5');
    expect(DEVANAGARI.test(text)).toBe(false);
  });

  it('falls back to English for an unknown language', () => {
    expect(makeT('xx')('learn.next')).toBe('Next');
  });
});
