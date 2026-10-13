/**
 * The explanation contract. Everything the Learn experience renders is one of
 * these objects, validated here, whether it was assembled from evidence,
 * taken from the concept library, or drafted by a model. Renderers are chosen
 * from a fixed registry by `diagramType`; nothing in this schema can carry
 * markup, script or a URL to fetch, so generated content cannot inject code.
 */
import { z } from 'zod';
import { DIAGRAM_TYPES, EDGE_KINDS, LAYER_IDS, LIMITS, NODE_KINDS, SCENE_IDS } from './model';

// Constants live in the zod-free module so the browser bundle can use them without pulling in zod.
export { DIAGRAM_TYPES, EDGE_KINDS, LAYER_IDS, LAYER_NAMES, LIMITS, NODE_KINDS, SCENE_IDS, SCENE_NAMES } from './model';
export type { DiagramType, LayerId, SceneId } from './model';


// Plain text only: no angle brackets, no control characters.
const plain = (max: number) => z.string().trim().min(1).max(max).regex(/^[^<>\u0000-\u0008\u000B\u000C\u000E-\u001F]*$/, 'must be plain text');
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'must be a lowercase slug');

export const DiagramNodeSchema = z.object({
  id,
  label: plain(LIMITS.label),
  detail: plain(LIMITS.detail).optional(),
  kind: z.enum(NODE_KINDS).default('process'),
});
export const DiagramEdgeSchema = z.object({
  from: id,
  to: id,
  label: plain(LIMITS.label).optional(),
  kind: z.enum(EDGE_KINDS).default('data'),
});

export const ExplanationStepSchema = z.object({
  id,
  title: plain(80),
  description: plain(LIMITS.detail),
  /** Node ids that are active at this step. Renderers highlight them and dim the rest. */
  focus: z.array(id).max(LIMITS.nodes).default([]),
  /** Ids of the discovery's sources or evidence checks that support this step. Empty for conceptual steps. */
  evidenceRefs: z.array(z.string().max(80)).max(8).default([]),
  /** True when the step shows how this kind of system generally works, not what this project documents. */
  illustrative: z.boolean(),
});

export const VisualizationSchema = z
  .object({
    id,
    title: plain(100),
    diagramType: z.enum(DIAGRAM_TYPES),
    nodes: z.array(DiagramNodeSchema).max(LIMITS.nodes).default([]),
    edges: z.array(DiagramEdgeSchema).max(LIMITS.edges).default([]),
    /** For `comparison`. */
    columns: z.array(z.object({ title: plain(LIMITS.label), points: z.array(plain(140)).min(1).max(LIMITS.points) })).max(LIMITS.columns).default([]),
    /** For `chart`: measured values only. */
    series: z.array(z.object({ label: plain(LIMITS.label), value: z.number().finite(), unit: plain(16).optional() })).max(LIMITS.series).default([]),
    steps: z.array(ExplanationStepSchema).min(1).max(LIMITS.steps),
    /** False means "illustrative conceptual architecture"; true means the sources document it. */
    confirmed: z.boolean(),
    /** Plain-language equivalent of the whole diagram, for screen readers and reduced motion. */
    textAlternative: plain(1200),
  })
  .superRefine((v, ctx) => {
    const ids = new Set(v.nodes.map((n) => n.id));
    if (ids.size !== v.nodes.length) ctx.addIssue({ code: 'custom', message: 'node ids must be unique' });
    for (const e of v.edges) if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: 'custom', message: `edge ${e.from}->${e.to} references an unknown node` });
    for (const s of v.steps) for (const f of s.focus) if (!ids.has(f)) ctx.addIssue({ code: 'custom', message: `step ${s.id} focuses unknown node ${f}` });
    if (new Set(v.steps.map((s) => s.id)).size !== v.steps.length) ctx.addIssue({ code: 'custom', message: 'step ids must be unique' });
    if (v.diagramType === 'comparison' && v.columns.length < 2) ctx.addIssue({ code: 'custom', message: 'a comparison needs at least two columns' });
    if (v.diagramType === 'chart' && v.series.length < 1) ctx.addIssue({ code: 'custom', message: 'a chart needs at least one value' });
    if (!['comparison', 'chart'].includes(v.diagramType) && v.nodes.length < 2) ctx.addIssue({ code: 'custom', message: 'a diagram needs at least two nodes' });
  });


export const LayerSchema = z.object({
  id: z.enum(LAYER_IDS),
  /** Statements taken from this discovery's own sources and checks. */
  evidence: z.array(plain(LIMITS.paragraph)).max(LIMITS.paragraphs).default([]),
  /** General explanation of this kind of technology. Not a claim about this project. */
  concept: z.array(plain(LIMITS.paragraph)).max(LIMITS.paragraphs).default([]),
  /** Where the explanation stops being accurate, or what is not known. */
  caveat: plain(500).optional(),
});


export const StorySceneSchema = z.object({
  id: z.enum(SCENE_IDS),
  narration: plain(700),
  /** Short line shown large on screen. */
  onScreen: plain(120),
  /** Diagram step shown during this scene, if any. */
  stepId: id.optional(),
  illustrative: z.boolean(),
  evidenceRefs: z.array(z.string().max(80)).max(8).default([]),
});

export const ExplanationSchema = z.object({
  discoveryId: z.string().regex(/^[a-f0-9]{12}$/),
  /** Hash of the source text this was built from. A changed source means a new version. */
  version: z.string().regex(/^[a-f0-9]{8,64}$/),
  conceptId: z.string().max(40).nullable(),
  conceptName: plain(80).nullable(),
  layers: z.array(LayerSchema).length(LAYER_IDS.length),
  visualization: VisualizationSchema.nullable(),
  scenes: z.array(StorySceneSchema).length(SCENE_IDS.length),
  method: z.enum(['assembled', 'llm']),
  model: z.string().max(80).nullable(),
});

export type DiagramNode = z.infer<typeof DiagramNodeSchema>;
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;
export type ExplanationStep = z.infer<typeof ExplanationStepSchema>;
export type Visualization = z.infer<typeof VisualizationSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type StoryScene = z.infer<typeof StorySceneSchema>;
export type Explanation = z.infer<typeof ExplanationSchema>;

/** Validates untrusted explanation data. Returns null instead of throwing so callers fall back safely. */
export function parseExplanation(raw: unknown): Explanation | null {
  const r = ExplanationSchema.safeParse(raw);
  return r.success ? r.data : null;
}
export function parseVisualization(raw: unknown): Visualization | null {
  const r = VisualizationSchema.safeParse(raw);
  return r.success ? r.data : null;
}
