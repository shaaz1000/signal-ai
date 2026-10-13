/**
 * The complete list of fixed English strings a bundled language must cover:
 * interface strings plus everything the concept library can put on screen.
 * Used by the coverage test and by `npm run i18n:extract`.
 */
import { buildExplanation } from '@/lib/explain/build';
import { CONCEPTS } from '@/lib/explain/concepts';
import { LAYER_NAMES, SCENE_NAMES } from '@/lib/explain/model';
import type { DiscoveryView } from '@/lib/types';
import { fixedTextOf } from './content';
import { EN } from './index';

/** A record with no evidence at all, so everything the builder emits is fixed text. */
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

export function conceptStrings(): string[] {
  const out = new Set<string>();
  for (const c of CONCEPTS) {
    const e = buildExplanation(emptyView(c.id));
    for (const s of fixedTextOf(e)) out.add(s);
    // Scenes that quote evidence are skipped by the localiser; with no evidence they hold fallbacks, which are fixed too.
    for (const scene of e.scenes) if (scene.illustrative) out.add(scene.narration);
  }
  // Text shown when no concept matches at all.
  for (const s of fixedTextOf(buildExplanation(emptyView('none')))) out.add(s);
  return [...out].filter((s) => s !== 'x' && s !== 'x.' && s.trim().length > 1);
}

export function interfaceStrings(): Record<string, string> {
  return { ...EN };
}

export const NAME_STRINGS = [...Object.values(LAYER_NAMES), ...Object.values(SCENE_NAMES)];
