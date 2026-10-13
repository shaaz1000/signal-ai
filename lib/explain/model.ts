/**
 * Browser-side half of the explanation contract: the constants, the types and
 * a small structural check. It deliberately does not import zod, which would
 * add several hundred kilobytes to the single-file page.
 *
 * `schema.ts` is the authoritative contract (zod) and is what the server and
 * the test suite validate against; a test asserts that the check below
 * accepts and rejects the same fixtures.
 */
import type { Explanation, Visualization } from './schema';

export type { DiagramEdge, DiagramNode, Explanation, ExplanationStep, Layer, StoryScene, Visualization } from './schema';

export const DIAGRAM_TYPES = ['flow', 'process', 'timeline', 'comparison', 'network', 'image-analysis', 'chart'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export const NODE_KINDS = ['input', 'process', 'model', 'tool', 'decision', 'output', 'human', 'store'] as const;
export const EDGE_KINDS = ['data', 'feedback', 'retry', 'approval'] as const;

/** Hard ceilings on diagram complexity. Enforced on every source, including model output. */
export const LIMITS = { steps: 12, nodes: 14, edges: 24, columns: 4, points: 8, series: 10, label: 48, detail: 320, paragraph: 900, paragraphs: 6 } as const;

export const LAYER_IDS = ['simple', 'analogy', 'how', 'deep', 'real-world'] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export const LAYER_NAMES: Record<LayerId, string> = {
  simple: 'Explain it simply',
  analogy: 'Everyday analogy',
  how: 'How it works',
  deep: 'Deep technical breakdown',
  'real-world': 'Real-world usage',
};

export const SCENE_IDS = ['problem', 'innovation', 'under-the-hood', 'demonstration', 'applications', 'limitations', 'why-it-matters', 'whats-next'] as const;
export type SceneId = (typeof SCENE_IDS)[number];
export const SCENE_NAMES: Record<SceneId, string> = {
  problem: 'The problem',
  innovation: 'The innovation',
  'under-the-hood': 'Under the hood',
  demonstration: 'Conceptual demonstration',
  applications: 'Real-world applications',
  limitations: 'Limitations',
  'why-it-matters': 'Why it matters',
  'whats-next': 'What is next',
};

const PLAIN = /^[^<>\u0000-\u0008\u000B\u000C\u000E-\u001F]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const text = (v: unknown, max: number, optional = false): boolean =>
  v === undefined ? optional : typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max && PLAIN.test(v);
const list = (v: unknown, max: number, min = 0): v is unknown[] => Array.isArray(v) && v.length >= min && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural check for a diagram. Returns the value unchanged when safe to render, otherwise null. */
export function parseVisualization(input: unknown): Visualization | null {
  if (!obj(input)) return null;
  // Fill the same defaults the zod schema does, on a copy, so renderers never meet a missing array.
  const arr = (x: unknown) => (x === undefined ? [] : x);
  const raw = {
    ...input,
    nodes: Array.isArray(input.nodes) ? input.nodes.map((n) => (obj(n) ? { ...n, kind: n.kind ?? 'process' } : n)) : arr(input.nodes),
    edges: Array.isArray(input.edges) ? input.edges.map((e) => (obj(e) ? { ...e, kind: e.kind ?? 'data' } : e)) : arr(input.edges),
    columns: arr(input.columns),
    series: arr(input.series),
    steps: Array.isArray(input.steps) ? input.steps.map((st) => (obj(st) ? { ...st, focus: arr(st.focus), evidenceRefs: arr(st.evidenceRefs) } : st)) : input.steps,
  };
  const v = raw as Record<string, unknown> & Partial<Visualization>;
  if (typeof v.id !== 'string' || !SLUG.test(v.id) || !text(v.title, 100) || !text(v.textAlternative, 1200) || typeof v.confirmed !== 'boolean') return null;
  if (!(DIAGRAM_TYPES as readonly string[]).includes(v.diagramType as string)) return null;
  if (!list(v.nodes, LIMITS.nodes) || !list(v.edges, LIMITS.edges) || !list(v.columns, LIMITS.columns) || !list(v.series, LIMITS.series) || !list(v.steps, LIMITS.steps, 1)) return null;

  const ids = new Set<string>();
  for (const n of v.nodes) {
    if (!obj(n) || typeof n.id !== 'string' || !SLUG.test(n.id) || ids.has(n.id) || !text(n.label, LIMITS.label) || !text(n.detail, LIMITS.detail, true)) return null;
    if (!(NODE_KINDS as readonly string[]).includes(n.kind as string)) return null;
    ids.add(n.id);
  }
  for (const e of v.edges) {
    if (!obj(e) || !ids.has(e.from as string) || !ids.has(e.to as string) || !text(e.label, LIMITS.label, true) || !(EDGE_KINDS as readonly string[]).includes(e.kind as string)) return null;
  }
  for (const c of v.columns) {
    if (!obj(c) || !text(c.title, LIMITS.label) || !list(c.points, LIMITS.points, 1) || !c.points.every((p) => text(p, 140))) return null;
  }
  for (const s of v.series) {
    if (!obj(s) || !text(s.label, LIMITS.label) || typeof s.value !== 'number' || !Number.isFinite(s.value) || !text(s.unit, 16, true)) return null;
  }
  const stepIds = new Set<string>();
  for (const s of v.steps) {
    if (!obj(s) || typeof s.id !== 'string' || !SLUG.test(s.id) || stepIds.has(s.id) || !text(s.title, 80) || !text(s.description, LIMITS.detail) || typeof s.illustrative !== 'boolean') return null;
    if (!list(s.focus, LIMITS.nodes) || !s.focus.every((f) => ids.has(f as string)) || !list(s.evidenceRefs, 8)) return null;
    stepIds.add(s.id);
  }
  if (v.diagramType === 'comparison' ? v.columns.length < 2 : v.diagramType === 'chart' ? v.series.length < 1 : v.nodes.length < 2) return null;
  return raw as unknown as Visualization;
}

/** Structural check for a whole explanation. */
export function parseExplanation(input: unknown): Explanation | null {
  if (!obj(input)) return null;
  const arr = (x: unknown) => (x === undefined ? [] : x);
  const visualization = input.visualization === null || input.visualization === undefined ? null : parseVisualization(input.visualization);
  if (input.visualization && !visualization) return null;
  const raw = {
    ...input,
    visualization,
    layers: Array.isArray(input.layers) ? input.layers.map((l) => (obj(l) ? { ...l, evidence: arr(l.evidence), concept: arr(l.concept) } : l)) : input.layers,
    scenes: Array.isArray(input.scenes) ? input.scenes.map((sc) => (obj(sc) ? { ...sc, evidenceRefs: arr(sc.evidenceRefs) } : sc)) : input.scenes,
  };
  const e = raw as Record<string, unknown> & Partial<Explanation>;
  if (typeof e.discoveryId !== 'string' || !/^[a-f0-9]{12}$/.test(e.discoveryId) || typeof e.version !== 'string' || !/^[a-f0-9]{8,64}$/.test(e.version)) return null;
  if (e.method !== 'assembled' && e.method !== 'llm') return null;
  if (e.conceptName !== null && !text(e.conceptName, 80)) return null;
  if (!list(e.layers, LAYER_IDS.length, LAYER_IDS.length) || !list(e.scenes, SCENE_IDS.length, SCENE_IDS.length)) return null;
  for (const l of e.layers) {
    if (!obj(l) || !(LAYER_IDS as readonly string[]).includes(l.id as string) || !text(l.caveat, 500, true)) return null;
    for (const key of ['evidence', 'concept'] as const) {
      if (!list(l[key], LIMITS.paragraphs) || !(l[key] as unknown[]).every((p) => text(p, LIMITS.paragraph))) return null;
    }
  }
  for (const s of e.scenes) {
    if (!obj(s) || !(SCENE_IDS as readonly string[]).includes(s.id as string) || !text(s.narration, 700) || !text(s.onScreen, 120) || typeof s.illustrative !== 'boolean' || !list(s.evidenceRefs, 8)) return null;
    if (s.stepId !== undefined && (typeof s.stepId !== 'string' || !SLUG.test(s.stepId))) return null;
  }
  return raw as unknown as Explanation;
}
