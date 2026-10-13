/**
 * Assembles an Explanation for a discovery without a model: evidence comes
 * from the stored record, general explanation from the concept library, and
 * the two are never mixed in one field. Pure and browser-safe, so the app,
 * the static site and the Artifact all build the same thing.
 */
import { CLAIM_LABELS, EXECUTION_LABELS, type DiscoveryView } from '@/lib/types';
import { EVIDENCE_STAGES, industryName, type EvidenceStage } from '@/lib/industries';
import { conceptById, detectConcept, type Concept } from './concepts';
import { LIMITS, parseExplanation, type Explanation, type Layer, type StoryScene, type Visualization } from './model';

/** Small non-cryptographic hash (FNV-1a, 64-bit as two 32-bit halves) for content versions in the browser. */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Third-party text can contain anything; the schema only accepts plain text. */
export function plain(text: string, max: number): string {
  const clean = text.replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const P = LIMITS.paragraph;
const keep = (items: (string | null | undefined | false)[], max = LIMITS.paragraphs): string[] =>
  items.filter((s): s is string => Boolean(s && s.trim())).map((s) => plain(s, P)).filter(Boolean).slice(0, max);

export function stageSentence(d: DiscoveryView): string | null {
  if (!d.evidenceStage) return null;
  const label = EVIDENCE_STAGES[d.evidenceStage.stage as EvidenceStage] ?? d.evidenceStage.stage;
  return d.evidenceStage.cue
    ? `Stated maturity: ${label}. The source text says "${d.evidenceStage.cue}".`
    : `Stated maturity: ${label}, implied by the type of source. The sources do not say more.`;
}

function technicalFacts(d: DiscoveryView): string[] {
  const facts: string[] = [];
  if (d.repo) {
    facts.push([
      d.repo.language ? `Written mainly in ${d.repo.language}.` : null,
      d.repo.license ? `Licence: ${d.repo.license}.` : 'No licence is declared.',
      d.repo.latestRelease ? `Latest tagged release: ${d.repo.latestRelease.tag}.` : 'No tagged release yet.',
      d.repo.contributors != null ? `${d.repo.contributors} contributors recorded by GitHub.` : null,
    ].filter(Boolean).join(' '));
    if (d.repo.topics.length) facts.push(`Topics set by the maintainers: ${d.repo.topics.slice(0, 8).join(', ')}.`);
  }
  if (d.model) {
    facts.push([
      d.model.vendor ? `Published by ${d.model.vendor}.` : null,
      d.model.openWeights === true ? 'The weights are downloadable.' : d.model.openWeights === false ? 'The weights are not public.' : null,
      d.model.license ? `Licence: ${d.model.license}.` : null,
      d.model.modalities.length ? `Listed modalities: ${d.model.modalities.join(', ')}.` : null,
      d.model.independentlyTested ? null : 'Capabilities are as described by the publisher; no independent test is on record here.',
    ].filter(Boolean).join(' '));
  }
  if (d.executionMode) facts.push(`How it runs, per the source text: ${EXECUTION_LABELS[d.executionMode]}.`);
  return facts;
}

function buildLayers(d: DiscoveryView, c: Concept | null): Layer[] {
  const noHow = 'The sources do not describe this project’s own implementation. The general explanation shows how systems of this kind usually work, which may differ from this one.';
  const usage = keep([
    stageSentence(d),
    d.industries.length ? `Relevant to: ${d.industries.map(industryName).join(', ')}.` : null,
    d.editorial.whoCares,
    d.editorial.applications,
    ...d.editorial.limitations.slice(0, 3),
  ]);
  return [
    { id: 'simple', evidence: keep([d.summary]), concept: keep(c?.simple ?? []) },
    { id: 'analogy', evidence: [], concept: keep(c ? [c.analogy] : []), caveat: c ? plain(`Where the comparison breaks down: ${c.analogyLimit}`, 500) : undefined },
    { id: 'how', evidence: keep([d.editorial.how]), concept: keep(c?.how ?? []), caveat: d.editorial.how ? undefined : noHow },
    { id: 'deep', evidence: keep(technicalFacts(d)), concept: keep(c?.deep ?? []), caveat: d.editorial.how ? undefined : 'Architecture details below are general to this kind of system, not confirmed for this project.' },
    { id: 'real-world', evidence: usage, concept: keep(c?.realWorld ?? []), caveat: d.evidenceStage ? undefined : 'The sources do not state how mature this is or where it is deployed.' },
  ];
}

function buildVisualization(c: Concept | null): Visualization | null {
  if (!c) return null;
  const g = c.diagram;
  return {
    id: c.id,
    title: g.title,
    diagramType: g.type,
    nodes: g.nodes.map((n) => ({ ...n })),
    edges: g.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, kind: e.kind ?? 'data' })),
    columns: g.columns ?? [],
    series: [],
    // Every step comes from the concept library, so every step is illustrative and carries no evidence refs.
    steps: g.steps.map((s) => ({ ...s, evidenceRefs: [], illustrative: true })),
    confirmed: false,
    textAlternative: g.textAlternative,
  };
}

function buildScenes(d: DiscoveryView, c: Concept | null, v: Visualization | null): StoryScene[] {
  const refs = d.sources.slice(0, 3).map((s) => s.sourceId);
  const N = 700;
  const first = v?.steps[0]?.id;
  const middle = v?.steps[Math.floor((v.steps.length - 1) / 2)]?.id;
  const open = d.evidence.filter((e) => e.outcome === 'unknown' || e.outcome === 'warn').map((e) => e.detail);
  const scene = (id: StoryScene['id'], narration: string, onScreen: string, extra: Partial<StoryScene> = {}): StoryScene => ({
    id, narration: plain(narration, N), onScreen: plain(onScreen, 120), illustrative: false, evidenceRefs: refs, ...extra,
  });
  return [
    scene('problem', c?.problem ?? 'The sources do not describe the problem this addresses, so none is stated here.', c ? 'Why this kind of technology exists' : 'The problem is not stated', { illustrative: Boolean(c), evidenceRefs: [] }),
    scene('innovation', `${d.headline}. ${d.summary}`, d.headline),
    scene(
      'under-the-hood',
      d.editorial.how ?? (c ? `The sources do not explain how this one works. In general: ${c.how.join(' ')}` : 'The sources do not explain how this works, and nothing is assumed here.'),
      d.editorial.how ? 'How it works, per its documentation' : 'How systems like this generally work',
      { illustrative: !d.editorial.how, stepId: middle, evidenceRefs: d.editorial.how ? refs : [] },
    ),
    scene(
      'demonstration',
      v ? `A conceptual walk-through, not a recording of this project. ${v.steps.map((s) => s.description).join(' ')}` : 'No conceptual demonstration is available for this item.',
      v ? 'A conceptual walk-through' : 'No demonstration available',
      { illustrative: true, stepId: first, evidenceRefs: [] },
    ),
    scene('applications', [stageSentence(d), d.editorial.whoCares, d.editorial.applications].filter(Boolean).join(' ') || 'The sources do not describe where this is used.', 'Who it is for, and how far along it is'),
    scene('limitations', d.editorial.limitations.slice(0, 3).join(' ') || 'No limitations are documented in the sources.', 'What it cannot be relied on for'),
    scene('why-it-matters', d.reasons.filter((r) => !r.startsWith('First picked up')).slice(0, 2).join('. ') || 'No measurable signal has been recorded yet.', 'The evidence behind the attention'),
    scene(
      'whats-next',
      open.length ? `Still open: ${open.slice(0, 3).join(' ')}` : `Every check passed at last verification. This is a ${CLAIM_LABELS[d.claimType].toLowerCase()}; later independent results would strengthen or weaken it.`,
      'Open questions',
    ),
  ];
}

export function buildExplanation(d: DiscoveryView): Explanation {
  const concept = conceptById(d.conceptId) ?? conceptById(detectConcept({ headline: `${d.headline} ${d.summary}`, text: `${d.tags.join(' ')} ${d.editorial.what}`, kind: d.kind }));
  const visualization = buildVisualization(concept);
  const explanation: Explanation = {
    discoveryId: d.id,
    version: contentHash([d.headline, d.summary, d.editorial.what, d.editorial.how ?? '', d.editorial.limitations.join('|'), concept?.id ?? '', d.evidenceStage?.stage ?? ''].join('\n')),
    conceptId: concept?.id ?? null,
    conceptName: concept?.name ?? null,
    layers: buildLayers(d, concept),
    visualization,
    scenes: buildScenes(d, concept, visualization),
    method: 'assembled',
    model: null,
  };
  // The builder must satisfy the same contract as model output. The test suite checks every output against the
  // zod schema; at runtime the structural check is enough to refuse anything unrenderable.
  const checked = parseExplanation(explanation);
  if (!checked) throw new Error(`Explanation for ${d.id} does not satisfy the contract`);
  return checked;
}

/** True when there is enough to teach from: a concept match or a documented mechanism. */
export function isExplainable(d: DiscoveryView): boolean {
  return Boolean(d.conceptId || d.editorial.how);
}
