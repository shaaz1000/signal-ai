/**
 * Creator Studio drafts assembled from stored evidence, with no model. Every
 * sentence is either a restated fact from the record or fixed scaffolding
 * (labels, timings, transitions), so a draft cannot contain a claim the
 * record does not. A configured AI provider can rewrite these more fluently
 * through the protected endpoint; that path is separate and guarded.
 */
import { CLAIM_LABELS, type DiscoveryView } from '@/lib/types';
import { SCENE_NAMES, type Explanation } from '@/lib/explain/model';
import { stageSentence } from '@/lib/explain/build';

export const FORMATS = [
  { id: 'hooks', name: 'Reel hooks', note: 'Five opening lines' },
  { id: 'script-30', name: '30-second script', note: 'About 75 spoken words' },
  { id: 'script-60', name: '60-second script', note: 'About 150 spoken words' },
  { id: 'shorts', name: 'YouTube Shorts script', note: 'With on-screen text' },
  { id: 'linkedin', name: 'LinkedIn post', note: 'Short paragraphs' },
  { id: 'article', name: 'News article', note: 'Inverted pyramid' },
  { id: 'explainer', name: 'Educational explainer', note: 'Plain language' },
  { id: 'deep-dive', name: 'Technical deep dive', note: 'For engineers' },
  { id: 'story-video', name: 'Story Mode video script', note: 'Scene by scene, with timing' },
] as const;
export type FormatId = (typeof FORMATS)[number]['id'];

export const TONES = [
  { id: 'educational', name: 'Educational' },
  { id: 'conversational', name: 'Conversational' },
  { id: 'technical', name: 'Technical' },
  { id: 'newsroom', name: 'Newsroom' },
  { id: 'documentary', name: 'Documentary' },
] as const;
export type ToneId = (typeof TONES)[number]['id'];

export interface DraftSection {
  label: string;
  text: string;
}
export interface Draft {
  format: FormatId;
  tone: ToneId;
  title: string;
  sections: DraftSection[];
  sources: { name: string; url: string }[];
  /** Things the creator must not state as fact, taken from the verification record. */
  cautions: string[];
  method: 'assembled' | 'llm';
}

// Tone changes framing words only. Facts are identical across tones.
const OPENERS: Record<ToneId, string> = {
  educational: 'Here is what this is and how it works.',
  conversational: 'Quick one worth knowing about.',
  technical: 'Summary for engineers.',
  newsroom: 'What is known so far.',
  documentary: 'A closer look at one project and the evidence around it.',
};
const ATTRIBUTION: Record<ToneId, string> = {
  educational: 'According to its own documentation,',
  conversational: 'From what the project itself says,',
  technical: 'Per the documentation,',
  newsroom: 'According to the project’s documentation,',
  documentary: 'In the words of its documentation,',
};

const sentence = (s: string) => (/[.!?…"”]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** Spoken length at a comfortable narration pace (about 150 words a minute). */
export const secondsFor = (text: string) => Math.max(3, Math.round((words(text) / 150) * 60));

function trim(text: string, maxWords: number): string {
  const parts = text.trim().split(/\s+/);
  if (parts.length <= maxWords) return text.trim();
  const cut = parts.slice(0, maxWords).join(' ');
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '));
  return end > cut.length * 0.5 ? cut.slice(0, end + 1) : `${cut}…`;
}

function facts(d: DiscoveryView) {
  const signal = d.reasons.filter((r) => !r.startsWith('First picked up') && !r.startsWith('Evidence is limited'));
  const independent = [...new Set(d.sources.filter((s) => !s.primary).map((s) => s.sourceName))];
  return {
    what: sentence(d.summary || d.headline),
    signal: signal.slice(0, 2).map(sentence),
    stage: stageSentence(d),
    confidence: `SIGNAL rates its confidence in this record at ${d.confidence} out of 100 (${d.confidenceLevel === 'unverified' ? 'not verified' : d.confidenceLevel}).`,
    claim: `This is a ${CLAIM_LABELS[d.claimType].toLowerCase()}${independent.length ? `, also referenced by ${independent.slice(0, 3).join(', ')}` : ', with no independent reference yet'}.`,
    limits: d.editorial.limitations.slice(0, 3).map(sentence),
    who: d.editorial.whoCares ? sentence(d.editorial.whoCares) : null,
  };
}

function cautions(d: DiscoveryView): string[] {
  const out = d.evidence.filter((e) => e.outcome === 'warn' || e.outcome === 'fail' || (e.outcome === 'unknown' && ['corroboration', 'review_status', 'execution_mode', 'code_available'].includes(e.check))).map((e) => e.detail);
  if (d.claimType === 'preprint') out.unshift('Say "preprint" or "the authors report". It has not been peer reviewed.');
  if (d.repo?.growth.observedDelta == null && d.repo) out.push('Star growth is an average since creation, not a measured rate. Do not call it "growing by X a day".');
  if (!d.editorial.how) out.push('The sources do not explain how it works. Do not describe its internals as fact.');
  return [...new Set(out)].slice(0, 6);
}

export function buildDraft(d: DiscoveryView, explanation: Explanation, format: FormatId, tone: ToneId = 'educational'): Draft {
  const f = facts(d);
  const how = d.editorial.how ? `${ATTRIBUTION[tone]} ${d.editorial.how.replace(/^According to the documentation:\s*/i, '')}` : null;
  const simple = explanation.layers.find((l) => l.id === 'simple')?.concept ?? [];
  const analogy = explanation.layers.find((l) => l.id === 'analogy');
  const name = d.repo ? `${d.repo.owner}/${d.repo.name}` : d.headline;
  const sources = d.sources.map((s) => ({ name: s.primary ? `${s.sourceName} (original)` : s.sourceName, url: s.url }));
  const base = { format, tone, sources, cautions: cautions(d), method: 'assembled' as const };
  const S = (label: string, text: string | null | undefined): DraftSection[] => (text && text.trim() ? [{ label, text: text.trim() }] : []);

  switch (format) {
    case 'hooks':
      return {
        ...base, title: `Opening lines for: ${d.headline}`,
        sections: [
          ...S('Hook 1: the fact', f.what),
          ...S('Hook 2: the signal', f.signal[0]),
          ...S('Hook 3: the question', `What does ${name} actually do, and what is still unproven?`),
          ...S('Hook 4: the caution', f.limits[0]),
          ...S('Hook 5: the audience', f.who),
        ],
      };
    case 'script-30':
    case 'script-60': {
      const long = format === 'script-60';
      const body = [f.what, f.signal[0], long ? how : null, long ? f.stage : null, f.limits[0], long ? f.claim : null].filter(Boolean).join(' ');
      return {
        ...base, title: `${long ? '60' : '30'}-second script: ${d.headline}`,
        sections: [
          ...S('Open (0 to 3 s)', OPENERS[tone]),
          ...S(`Body (about ${secondsFor(trim(body, long ? 130 : 60))} s)`, trim(body, long ? 130 : 60)),
          ...S('Close', `Source and details in the description. ${f.confidence}`),
        ],
      };
    }
    case 'shorts':
      return {
        ...base, title: `Shorts script: ${d.headline}`,
        sections: [
          ...S('On-screen text', trim(d.headline, 9)),
          ...S('Voice-over', trim([f.what, f.signal[0], f.limits[0]].filter(Boolean).join(' '), 110)),
          ...S('Caption', `${trim(d.summary, 24)} Source linked below.`),
          ...S('Pinned comment', f.claim),
        ],
      };
    case 'linkedin':
      return {
        ...base, title: `LinkedIn post: ${d.headline}`,
        sections: [
          ...S('Post', [OPENERS[tone], '', f.what, '', ...f.signal, '', how ?? 'The sources do not explain how it works internally.', '', `Worth knowing: ${f.limits[0] ?? 'no limitations are documented.'}`, '', f.who ?? '', '', `${f.claim} ${f.confidence}`].join('\n').replace(/\n{3,}/g, '\n\n')),
        ],
      };
    case 'article':
      return {
        ...base, title: d.headline,
        sections: [
          ...S('Lede', f.what),
          ...S('What is known', [...f.signal, f.claim].join(' ')),
          ...S('How it works', how ?? 'The available sources do not describe the implementation.'),
          ...S('Maturity', f.stage),
          ...S('Limitations', f.limits.join(' ')),
          ...S('Verification', f.confidence),
        ],
      };
    case 'explainer':
      return {
        ...base, title: `Explainer: ${d.headline}`,
        sections: [
          ...S('What it is', f.what),
          ...S(`Background: ${explanation.conceptName ?? 'this kind of technology'} (general, not specific to this project)`, simple.join(' ')),
          ...S('A way to picture it', analogy?.concept[0]),
          ...S('Where the picture breaks down', analogy?.caveat),
          ...S('How this one works', how ?? 'Its sources do not say. The background above describes the general approach only.'),
          ...S('What it cannot be relied on for', f.limits.join(' ')),
        ],
      };
    case 'deep-dive': {
      const deep = explanation.layers.find((l) => l.id === 'deep');
      return {
        ...base, title: `Technical deep dive: ${d.headline}`,
        sections: [
          ...S('Summary', `${OPENERS.technical} ${f.what}`),
          ...S('Confirmed from the sources', [how, ...(deep?.evidence ?? [])].filter(Boolean).join(' ')),
          ...S('General architecture for this class of system (illustrative, not confirmed for this project)', (deep?.concept ?? []).join(' ')),
          ...S('Maturity and evidence', [f.stage, f.claim, f.confidence].filter(Boolean).join(' ')),
          ...S('Open questions', d.evidence.filter((e) => e.outcome !== 'pass').map((e) => e.detail).slice(0, 4).join(' ')),
        ],
      };
    }
    case 'story-video': {
      let clock = 0;
      const sections = explanation.scenes.map((scene, i) => {
        const seconds = secondsFor(scene.narration);
        const start = clock;
        clock += seconds;
        const step = explanation.visualization?.steps.find((s) => s.id === scene.stepId);
        return {
          label: `Scene ${i + 1}: ${SCENE_NAMES[scene.id]} (${start}s to ${clock}s)`,
          text: [
            `Narration: ${scene.narration}`,
            `On-screen text: ${scene.onScreen}`,
            `Visual: ${step ? `Diagram "${explanation.visualization!.title}", step "${step.title}".` : 'Title card with the on-screen text.'}${scene.illustrative ? ' Label the frame "Illustrative".' : ''}`,
            `Transition: ${i === 0 ? 'Open on the title.' : i === explanation.scenes.length - 1 ? 'Hold on the sources list.' : 'Cut on the last word.'}`,
            `Caption: ${trim(scene.narration, 18)}`,
          ].join('\n'),
        };
      });
      return {
        ...base, title: `Video script from Story Mode: ${d.headline}`,
        sections: [...sections, { label: `Total running time`, text: `About ${clock} seconds at a narration pace of 150 words a minute. This is a script; no video file is rendered.` }],
      };
    }
  }
}

export function draftToText(draft: Draft): string {
  return [
    draft.title, '',
    ...draft.sections.flatMap((s) => [s.label.toUpperCase(), s.text, '']),
    'SOURCES', ...draft.sources.map((s) => `${s.name}: ${s.url}`),
    ...(draft.cautions.length ? ['', 'DO NOT STATE AS FACT', ...draft.cautions.map((c) => `- ${c}`)] : []),
  ].join('\n');
}

/**
 * Content Radar: how good a story this would make, for a creator who cares
 * about being right. Unverified items score zero by rule.
 */
export function contentOpportunity(d: DiscoveryView): { score: number; reasons: string[] } {
  if (d.status !== 'verified') return { score: 0, reasons: ['Not verified, so not recommended as source material.'] };
  const independent = new Set(d.sources.filter((s) => !s.primary).map((s) => s.sourceId)).size;
  const explainable = (d.conceptId ? 55 : 0) + (d.editorial.how ? 45 : 0);
  const saturated = independent >= 4;
  const score = 0.3 * d.scores.novelty + 0.2 * d.scores.significance + 0.2 * d.scores.credibility + 0.2 * explainable + 0.1 * d.scores.momentum - (saturated ? 8 : 0);
  const reasons = [
    d.scores.novelty >= 70 ? 'New: little has been written about it yet.' : null,
    d.editorial.how ? 'Its sources explain how it works, so the explanation can be specific.' : d.conceptId ? 'A general explainer and diagram are available for this kind of technology.' : 'Hard to explain: the sources give no mechanism.',
    independent === 0 ? 'No independent coverage yet: early, but single-sourced.' : `${independent} independent ${independent === 1 ? 'source has' : 'sources have'} referenced it.`,
    saturated ? 'Already widely covered.' : null,
    d.confidenceLevel === 'high' ? 'High confidence record.' : null,
  ].filter((r): r is string => Boolean(r));
  return { score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10, reasons };
}
