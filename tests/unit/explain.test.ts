import { describe, expect, it } from 'vitest';
import { buildExplanation, contentHash, isExplainable, plain } from '@/lib/explain/build';
import { CONCEPTS, conceptById, detectConcept } from '@/lib/explain/concepts';
import { ExplanationSchema, LAYER_IDS, LIMITS, parseExplanation, parseVisualization, SCENE_IDS, VisualizationSchema } from '@/lib/explain/schema';
import { classifyIndustries, detectEvidenceStage, INDUSTRIES } from '@/lib/industries';
import { makeView } from '../fixtures/view';

const validViz = () => structuredClone(buildExplanation(makeView()).visualization!);

describe('explanation schema', () => {
  it('accepts every visualization in the concept library', () => {
    for (const c of CONCEPTS) {
      const e = buildExplanation(makeView({ conceptId: c.id }));
      expect(VisualizationSchema.safeParse(e.visualization).success, c.id).toBe(true);
      expect(e.visualization!.steps.length).toBeLessThanOrEqual(LIMITS.steps);
    }
  });

  it('rejects markup, scripts and anything that is not plain text', () => {
    for (const bad of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'a > b', 'bell\u0007']) {
      const v = validViz();
      v.nodes[0].label = bad;
      expect(parseVisualization(v), bad).toBeNull();
    }
  });

  it('rejects edges and steps that reference unknown nodes, and duplicate ids', () => {
    const edge = validViz();
    edge.edges.push({ from: 'goal', to: 'nowhere', kind: 'data' });
    expect(parseVisualization(edge)).toBeNull();
    const focus = validViz();
    focus.steps[0].focus = ['ghost'];
    expect(parseVisualization(focus)).toBeNull();
    const dup = validViz();
    dup.nodes.push({ ...dup.nodes[0] });
    expect(parseVisualization(dup)).toBeNull();
  });

  it('enforces complexity ceilings and the fixed set of diagram types', () => {
    const many = validViz();
    many.nodes = Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, kind: 'process' as const }));
    many.edges = [];
    many.steps = [{ ...many.steps[0], focus: [] }];
    expect(parseVisualization(many)).toBeNull();
    expect(parseVisualization({ ...validViz(), diagramType: 'iframe' })).toBeNull();
    expect(parseVisualization({ ...validViz(), steps: [] })).toBeNull();
    expect(parseVisualization({ ...validViz(), diagramType: 'comparison', columns: [] })).toBeNull();
  });

  it('does not allow extra executable-looking fields to carry through', () => {
    const parsed = parseVisualization({ ...validViz(), onLoad: 'fetch("https://evil.example")', html: '<b>x</b>' }) as Record<string, unknown> | null;
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('onLoad');
    expect(parsed).not.toHaveProperty('html');
  });

  it('returns null for malformed explanations instead of throwing', () => {
    expect(parseExplanation(null)).toBeNull();
    expect(parseExplanation({ discoveryId: 'nope' })).toBeNull();
    expect(parseExplanation({ ...buildExplanation(makeView()), layers: [] })).toBeNull();
  });
});

describe('buildExplanation', () => {
  it('produces all five layers and all eight scenes, and satisfies the schema', () => {
    const e = buildExplanation(makeView());
    expect(e.layers.map((l) => l.id)).toEqual([...LAYER_IDS]);
    expect(e.scenes.map((s) => s.id)).toEqual([...SCENE_IDS]);
    expect(ExplanationSchema.safeParse(e).success).toBe(true);
    expect(e.method).toBe('assembled');
  });

  it('keeps source evidence and general concept text in separate fields', () => {
    const d = makeView();
    const e = buildExplanation(d);
    const how = e.layers.find((l) => l.id === 'how')!;
    expect(how.evidence[0]).toContain('serialises the tool list');
    expect(how.concept.join(' ')).toContain('language model');
    expect(how.concept.join(' ')).not.toContain('serialises the tool list');
    expect(e.layers.find((l) => l.id === 'simple')!.evidence).toEqual([d.summary]);
  });

  it('never presents a concept diagram as the project’s confirmed architecture', () => {
    const e = buildExplanation(makeView());
    expect(e.visualization!.confirmed).toBe(false);
    expect(e.visualization!.steps.every((s) => s.illustrative && s.evidenceRefs.length === 0)).toBe(true);
    expect(e.scenes.find((s) => s.id === 'demonstration')!.illustrative).toBe(true);
  });

  it('says so when the sources do not explain the mechanism, rather than inventing one', () => {
    const d = makeView({ editorial: { ...makeView().editorial, how: null } });
    const e = buildExplanation(d);
    const how = e.layers.find((l) => l.id === 'how')!;
    expect(how.evidence).toEqual([]);
    expect(how.caveat).toMatch(/do not describe this project’s own implementation/);
    const scene = e.scenes.find((s) => s.id === 'under-the-hood')!;
    expect(scene.illustrative).toBe(true);
    expect(scene.narration).toMatch(/^The sources do not explain how this one works/);
    expect(scene.evidenceRefs).toEqual([]);
  });

  it('draws nothing when there is no concept and no documented mechanism', () => {
    const d = makeView({ conceptId: null, kind: 'article', headline: 'Quarterly earnings call', summary: 'A company reported results.', tags: [], repo: null, editorial: { ...makeView().editorial, what: 'A company reported results.', how: null } });
    const e = buildExplanation(d);
    expect(e.visualization).toBeNull();
    expect(e.conceptId).toBeNull();
    expect(isExplainable(d)).toBe(false);
    expect(e.scenes.find((s) => s.id === 'problem')!.narration).toMatch(/do not describe the problem/);
  });

  it('carries the stated maturity with the phrase that supports it', () => {
    const e = buildExplanation(makeView({ evidenceStage: { stage: 'clinical-trial', cue: 'prospective study' }, industries: ['healthcare'] }));
    const usage = e.layers.find((l) => l.id === 'real-world')!.evidence.join(' ');
    expect(usage).toContain('Clinical trial');
    expect(usage).toContain('"prospective study"');
    expect(usage).toContain('Healthcare and medicine');
  });

  it('strips markup from third-party text before it reaches a renderer', () => {
    const d = makeView({ headline: 'Tool <img src=x onerror=alert(1)>', summary: 'Does <b>things</b> <script>steal()</script>' });
    const e = buildExplanation(d);
    const all = JSON.stringify(e);
    expect(all).not.toMatch(/[<>]/);
    expect(ExplanationSchema.safeParse(e).success).toBe(true);
  });

  it('survives very long source text', () => {
    const long = 'word '.repeat(4000);
    const e = buildExplanation(makeView({ summary: long, editorial: { ...makeView().editorial, how: long, limitations: [long, long, long, long] } }));
    expect(e.layers.every((l) => l.evidence.every((p) => p.length <= LIMITS.paragraph))).toBe(true);
    expect(e.scenes.every((s) => s.narration.length <= 700)).toBe(true);
  });

  it('versions by source content, so a changed source invalidates anything cached against it', () => {
    const a = buildExplanation(makeView());
    const b = buildExplanation(makeView());
    const c = buildExplanation(makeView({ summary: 'A different summary.' }));
    expect(a.version).toBe(b.version);
    expect(c.version).not.toBe(a.version);
    expect(contentHash('x')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('truncates on a word boundary', () => {
    expect(plain('alpha beta gamma delta', 12)).toBe('alpha beta…');
  });
});

describe('concept detection', () => {
  it.each([
    ['An MCP server that lets agents drive a browser', '', 'repository', 'agent-loop'],
    ['Open-source RAG pipeline with a vector database', '', 'repository', 'rag'],
    ['Text-to-video diffusion model', '', 'model', 'diffusion'],
    ['Whisper-based speech recognition in Rust', '', 'repository', 'speech'],
    ['A humanoid robot learns manipulation from demonstrations', '', 'paper', 'robotics'],
    ['Chest X-ray triage with deep learning', '', 'paper', 'medical-imaging'],
    ['A GameCube emulator compiled to WebAssembly', '', 'repository', 'emulation'],
    ['acme/small-coder-3b', '', 'model', 'model-release'],
    ['On the convergence of stochastic gradient methods', '', 'paper', 'research-method'],
  ])('%s -> %s', (headline, text, kind, expected) => {
    expect(detectConcept({ headline, text, kind })).toBe(expected);
  });

  it('lets the title decide over a passing mention in the documentation', () => {
    expect(detectConcept({ headline: 'A photo editor written in Rust', text: 'Our CI uses an agent to run tests', kind: 'repository' })).toBe('agent-loop');
    expect(detectConcept({ headline: 'A speech recognition library', text: 'unrelated mention of agents', kind: 'repository' })).toBe('speech');
  });

  it('returns null when nothing matches', () => {
    expect(detectConcept({ headline: 'Notes on bread', text: 'flour and water', kind: 'article' })).toBeNull();
    expect(conceptById('nope')).toBeNull();
  });
});

describe('industries and stated maturity', () => {
  it('classifies into several industries or none', () => {
    expect(classifyIndustries('Deep learning for radiology in hospitals')).toContain('healthcare');
    expect(classifyIndustries('Autonomous driving perception stack for robotaxi fleets')).toEqual(expect.arrayContaining(['transport']));
    expect(classifyIndustries('A JSON parser')).toEqual([]);
    expect(new Set(INDUSTRIES.map((i) => i.id)).size).toBe(18);
  });

  it('separates preclinical work, trials, clearance and clinical use, quoting the phrase', () => {
    const s = (text: string) => detectEvidenceStage({ text, industries: ['healthcare'], claimType: 'preprint' });
    expect(s('a retrospective analysis of 10,000 scans')).toEqual({ stage: 'preclinical', cue: 'retrospective analysis' });
    expect(s('results of a randomized controlled trial')).toMatchObject({ stage: 'clinical-trial' });
    expect(s('the device is FDA-cleared for triage')).toMatchObject({ stage: 'regulatory-clearance', cue: 'FDA-cleared' });
    expect(s('now in clinical use at three sites')).toMatchObject({ stage: 'clinical-deployment' });
  });

  it('separates defence concepts, tests, vendor claims and deployment', () => {
    const s = (text: string) => detectEvidenceStage({ text, industries: ['defence'], claimType: 'third_party' })?.stage;
    expect(s('a white paper proposing swarm coordination')).toBe('concept');
    expect(s('demonstrated during a field trial last month')).toBe('field-test');
    expect(s('the company says the system can identify targets')).toBe('vendor-claim');
    expect(s('the system is in active service')).toBe('operational-deployment');
  });

  it('does not infer a stage the text does not state', () => {
    expect(detectEvidenceStage({ text: 'an imaging model with high accuracy', industries: ['healthcare'], claimType: 'project_release' })).toBeNull();
    expect(detectEvidenceStage({ text: 'an imaging model', industries: ['healthcare'], claimType: 'preprint' })).toEqual({ stage: 'research', cue: null });
    // Medical rules are not applied to non-medical items.
    expect(detectEvidenceStage({ text: 'phase 2 of our roadmap', industries: [], claimType: 'project_release' })).toBeNull();
  });
});

describe('browser-side structural check agrees with the zod contract', () => {
  it('accepts and rejects the same visualizations', async () => {
    const light = await import('@/lib/explain/model');
    const base = () => structuredClone(buildExplanation(makeView()).visualization!);
    const cases: [string, unknown][] = [
      ['valid', base()],
      ['markup in a label', (() => { const v = base(); v.nodes[0].label = '<b>x</b>'; return v; })()],
      ['unknown edge target', (() => { const v = base(); v.edges.push({ from: 'goal', to: 'ghost', kind: 'data' }); return v; })()],
      ['duplicate node id', (() => { const v = base(); v.nodes.push({ ...v.nodes[0] }); return v; })()],
      ['unknown diagram type', { ...base(), diagramType: 'iframe' }],
      ['no steps', { ...base(), steps: [] }],
      ['focus on unknown node', (() => { const v = base(); v.steps[0].focus = ['ghost']; return v; })()],
      ['too many nodes', (() => { const v = base(); v.nodes = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'process' as const })); v.edges = []; v.steps = [{ ...v.steps[0], focus: [] }]; return v; })()],
      ['overlong label', (() => { const v = base(); v.nodes[0].label = 'x'.repeat(60); return v; })()],
      ['comparison without columns', { ...base(), diagramType: 'comparison', columns: [] }],
      ['not an object', 'nope'],
    ];
    for (const [name, value] of cases) {
      expect(light.parseVisualization(value) !== null, name).toBe(VisualizationSchema.safeParse(value).success);
    }
    for (const c of CONCEPTS) {
      const e = buildExplanation(makeView({ conceptId: c.id }));
      expect(light.parseExplanation(e), c.id).not.toBeNull();
      expect(ExplanationSchema.safeParse(e).success, c.id).toBe(true);
    }
    expect(light.parseExplanation({ ...buildExplanation(makeView()), scenes: [] })).toBeNull();
    expect(light.parseExplanation({ ...buildExplanation(makeView()), version: '<script>' })).toBeNull();
  });
});
