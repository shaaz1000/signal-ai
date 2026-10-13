// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LayerView } from '@/components/learn/layer-switcher';
import { sceneDwellMs, StoryPlayer, STORY_SPEEDS } from '@/components/learn/story-player';
import { RENDERERS, SUPPORTED_DIAGRAM_TYPES, VisualizationView, type VisualizationViewProps } from '@/components/learn/visualization';
import { DIAGRAM_TYPES, LAYER_IDS, LAYER_NAMES, parseExplanation, parseVisualization, SCENE_IDS, SCENE_NAMES, type Explanation, type LayerId, type Visualization } from '@/lib/explain/schema';
import { EN, makeT } from '@/lib/i18n';

const t = makeT('en');
const valid = (raw: unknown): Visualization => {
  const parsed = parseVisualization(raw);
  if (!parsed) throw new Error('fixture is not a valid visualization');
  return parsed;
};
const view = (visualization: Visualization, props: Partial<VisualizationViewProps> = {}) => renderToStaticMarkup(createElement(VisualizationView, { visualization, t, ...props }));
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

// An agent loop: plan, act, check, retry on failure, and a person approves before anything is sent.
const AGENT_LOOP = {
  id: 'agent-loop', title: 'How an agent loop runs', diagramType: 'flow',
  nodes: [
    { id: 'goal', label: 'Goal from the user', detail: 'The task, in the user’s own words.', kind: 'input' },
    { id: 'plan', label: 'Plan the next action', detail: 'The model picks one step to try.', kind: 'model' },
    { id: 'act', label: 'Call a tool', detail: 'Search, run code or read a file.', kind: 'tool' },
    { id: 'check', label: 'Check the result', kind: 'decision' },
    { id: 'approve', label: 'Person approves', detail: 'A human signs off before anything is sent.', kind: 'human' },
    { id: 'answer', label: 'Final answer', kind: 'output' },
  ],
  edges: [
    { from: 'goal', to: 'plan' },
    { from: 'plan', to: 'act' },
    { from: 'act', to: 'check', label: 'tool output' },
    { from: 'check', to: 'plan', kind: 'retry' },
    { from: 'check', to: 'approve', kind: 'approval', label: 'needs sign-off' },
    { from: 'approve', to: 'answer' },
  ],
  steps: [
    { id: 'start', title: 'A goal arrives', description: 'The loop starts from what the user asked for.', focus: ['goal', 'plan'], illustrative: false, evidenceRefs: ['src-1'] },
    { id: 'work', title: 'Plan, act, check', description: 'The model plans, calls a tool and looks at what came back.', focus: ['plan', 'act', 'check'], illustrative: true },
    { id: 'retry', title: 'Try again when it fails', description: 'A failed check sends the loop back to planning.', focus: ['check', 'plan'], illustrative: true },
    { id: 'finish', title: 'A person approves the answer', description: 'Nothing leaves without sign-off.', focus: ['approve', 'answer'], illustrative: false },
  ],
  confirmed: false,
  textAlternative: 'A goal goes to a model that plans, calls a tool and checks the result, retrying on failure; a person approves the final answer.',
};

const MEDICAL_IMAGING = {
  id: 'imaging', title: 'How an image model flags a region', diagramType: 'image-analysis',
  nodes: [
    { id: 'scan', label: 'Image', detail: 'The picture to be analysed.', kind: 'input' },
    { id: 'vision', label: 'Vision model', detail: 'Scores every area of the picture.', kind: 'model' },
    { id: 'finding', label: 'Flagged region', detail: 'The area the model scored highest.', kind: 'output' },
    { id: 'clinician', label: 'Clinician reviews', detail: 'A qualified person makes the decision.', kind: 'human' },
  ],
  edges: [{ from: 'scan', to: 'vision' }, { from: 'vision', to: 'finding' }, { from: 'finding', to: 'clinician', kind: 'approval' }],
  steps: [
    { id: 'in', title: 'An image goes in', description: 'The model receives the picture.', focus: ['scan', 'vision'], illustrative: true },
    { id: 'out', title: 'A region is flagged', description: 'The model marks where it found something.', focus: ['vision', 'finding'], illustrative: true },
    { id: 'review', title: 'A clinician decides', description: 'The flag is a prompt for a person, not a diagnosis.', focus: ['finding', 'clinician'], illustrative: true },
  ],
  confirmed: false,
  textAlternative: 'An image goes into a vision model, which flags a region; a clinician reviews the flag.',
};

const MODEL_COMPARISON = {
  id: 'compare', title: 'Small model or large model', diagramType: 'comparison',
  columns: [
    { title: 'Small model', points: ['Runs on a laptop', 'Answers quickly'] },
    { title: 'Large model', points: ['Needs a data centre', 'Handles longer documents'] },
  ],
  steps: [{ id: 'trade', title: 'The trade-off', description: 'Speed and cost against capability.', illustrative: true }],
  confirmed: false,
  textAlternative: 'A small model is fast and cheap; a large one is more capable and costs more.',
};

const BENCHMARK_CHART = {
  id: 'bench', title: 'Reported benchmark scores', diagramType: 'chart',
  series: [{ label: 'This model', value: 92.5, unit: '%' }, { label: 'Previous best', value: 46.25, unit: '%' }, { label: 'Latency', value: 1200, unit: 'ms' }],
  steps: [{ id: 'read', title: 'Reading the chart', description: 'Each bar is a figure the sources report.', illustrative: false }],
  confirmed: true,
  textAlternative: 'This model scores 92.5 percent; the previous best scored 46.25 percent.',
};

const RELEASE_TIMELINE = {
  id: 'history', title: 'Release history', diagramType: 'timeline',
  nodes: [{ id: 'paper', label: 'Paper published', detail: 'The preprint appears.' }, { id: 'code', label: 'Code released' }, { id: 'weights', label: 'Weights released', kind: 'store' }],
  steps: [
    { id: 'first', title: 'It starts with a paper', description: 'The work is described before it is shared.', focus: ['paper'], illustrative: false },
    { id: 'then', title: 'Then the code', description: 'Code and weights follow.', focus: ['code', 'weights'], illustrative: false },
  ],
  confirmed: true,
  textAlternative: 'The paper came first, then the code, then the weights.',
};

const PIPELINE_NETWORK = { ...AGENT_LOOP, id: 'net', title: 'Parts and how they connect', diagramType: 'network' };
const PROCESS = { ...AGENT_LOOP, id: 'proc', title: 'The same loop as a process', diagramType: 'process' };
const FIXTURES: Record<string, unknown> = { flow: AGENT_LOOP, process: PROCESS, network: PIPELINE_NETWORK, timeline: RELEASE_TIMELINE, comparison: MODEL_COMPARISON, chart: BENCHMARK_CHART, 'image-analysis': MEDICAL_IMAGING };

const EXPLANATION = {
  discoveryId: 'abcdef012345', version: 'deadbeef', conceptId: 'agent-loop', conceptName: 'Agent loop',
  layers: [
    { id: 'simple', evidence: ['The README says the tool plans and runs tasks by itself.'], concept: ['An agent is a program that decides its own next step.'], caveat: 'The sources do not say how often it fails.' },
    { id: 'analogy', concept: ['Think of a cook who tastes the soup and adjusts it.'] },
    { id: 'how', evidence: ['The repository lists a planner and a tool runner.'] },
    { id: 'deep' },
    { id: 'real-world', evidence: ['One linked post describes using it for code review.'], concept: ['Loops like this are used for research assistants.'] },
  ],
  visualization: AGENT_LOOP,
  scenes: SCENE_IDS.map((id, i) => ({
    id,
    narration: `Narration for scene ${i + 1}, which explains ${SCENE_NAMES[id].toLowerCase()} in a few plain sentences.`,
    onScreen: `On screen line ${i + 1}`,
    illustrative: i % 2 === 1,
    ...(i === 2 ? { stepId: 'work' } : i === 3 ? { stepId: 'retry' } : {}),
  })),
  method: 'assembled', model: null,
} as unknown as Explanation;

describe('renderer registry', () => {
  it('has exactly one renderer per diagram type in the schema', () => {
    expect([...SUPPORTED_DIAGRAM_TYPES].sort()).toEqual([...DIAGRAM_TYPES].sort());
    for (const type of DIAGRAM_TYPES) expect(typeof RENDERERS[type]).toBe('function');
  });

  it.each(DIAGRAM_TYPES.map((type) => [type] as const))('renders a valid %s fixture', (type) => {
    const v = valid(FIXTURES[type]);
    const html = view(v);
    expect(html).toContain(`data-diagram="${type}"`);
    expect(html).not.toContain('data-fallback');
    expect(html).toContain(v.title);
    expect(html).toContain(v.steps[0].title);
    expect(html).toContain(t('learn.step', { n: 1, total: v.steps.length }));
    // The text alternative is both linked to the figure and readable on demand.
    expect(count(html, new RegExp(v.textAlternative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toBe(2);
    expect(html).toMatch(/<figure[^>]*aria-describedby="[^"]+"/);
    expect(html).toContain(`<summary>${EN['learn.readAsText']}</summary>`);
    if (type === 'comparison' || type === 'chart') expect(html).not.toContain('viz-svg');
    else expect(count(html, /class="viz-node"/g)).toBe(v.nodes.length);
  });
});

describe('untrusted data', () => {
  const INVALID: [string, unknown][] = [
    ['an edge to an unknown node', { ...AGENT_LOOP, edges: [{ from: 'goal', to: 'nowhere' }] }],
    ['thirty nodes', { ...AGENT_LOOP, nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })), edges: [], steps: [{ id: 's', title: 'S', description: 'D', illustrative: true }] }],
    ['a script string', { ...AGENT_LOOP, title: '<script>alert(1)</script>' }],
    ['an unknown diagram type', { ...AGENT_LOOP, diagramType: 'hologram' }],
    ['a step that focuses an unknown node', { ...AGENT_LOOP, steps: [{ id: 's', title: 'S', description: 'D', focus: ['ghost'], illustrative: true }] }],
    ['no steps', { ...AGENT_LOOP, steps: [] }],
  ];

  it.each(INVALID)('shows the text alternative for %s and does not throw', (_name, raw) => {
    const html = view(raw as never);
    expect(html).toContain('data-fallback="true"');
    expect(html).toContain(EN['learn.diagramUnavailable']);
    expect(html).toContain(AGENT_LOOP.textAlternative);
    expect(html).not.toContain('viz-svg');
    expect(html).not.toContain('<script');
  });

  it.each([[null], [undefined], [42], ['flow'], [[]], [{}], [{ steps: 'nope', title: 7, textAlternative: { toString: 1 } }], [{ steps: [null, 3, { title: {} }] }]])('survives %j', (raw) => {
    const html = view(raw as never);
    expect(html).toContain('data-fallback="true"');
    expect(html).toContain(EN['learn.noTextAlternative']);
  });

  it('escapes text that looks like markup, wherever it lands', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = view({ ...AGENT_LOOP, title: hostile, textAlternative: `${hostile} tail`, steps: [{ id: 's', title: '<b>bold</b>', description: '<script>alert(2)</script>', illustrative: true }] } as never);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).not.toMatch(/<img|<b>|<script/);
  });

  it('escapes entities and quotes in a visualization that passes validation', () => {
    const v = valid({ ...AGENT_LOOP, nodes: AGENT_LOOP.nodes.map((n) => (n.id === 'goal' ? { ...n, label: 'Q&A "quoted" &lt;b&gt;' } : n)) });
    const html = view(v);
    expect(html).toContain('aria-label="Q&amp;A &quot;quoted&quot; &amp;lt;b&amp;gt;, Input, active"');
    expect(html).not.toContain('<b>');
  });

  it('never bypasses React escaping or pulls in the framework', () => {
    const dir = path.resolve(import.meta.dirname, '../../components/learn');
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source.startsWith("'use client';"), file).toBe(true);
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|\beval\(|new Function|from 'next\/|\buse\(|useActionState|href=/);
    }
  });

  it('adds no colour literals to the stylesheet', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');
    const block = css.slice(css.indexOf('/* ── Learn: diagrams and Story Mode ── */'));
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const token of ['--motion-fast: 150ms', '--motion-base: 240ms', '--motion-slow: 360ms', 'cubic-bezier(0.2, 0, 0, 1)']) expect(block).toContain(token);
  });
});

describe('VisualizationView', () => {
  const flow = valid(AGENT_LOOP);

  it('states whether the diagram is illustrative or confirmed', () => {
    const illustrative = view(flow);
    expect(illustrative).toContain(EN['learn.illustrative']);
    expect(illustrative).not.toContain(EN['learn.confirmed']);
    expect(illustrative).toContain('data-confirmed="false"');
    const confirmed = view(valid({ ...AGENT_LOOP, confirmed: true }));
    expect(confirmed).toContain(EN['learn.confirmed']);
    expect(confirmed).not.toContain(EN['learn.illustrative']);
    expect(confirmed).toContain('data-confirmed="true"');
  });

  it('marks the focus nodes of the active step and dims the others without hiding them', () => {
    const html = view(flow, { stepIndex: 1 });
    const nodes = html.match(/<g class="viz-node"[^>]*>/g) ?? [];
    expect(nodes).toHaveLength(6);
    const stateOf = (label: string) => nodes.find((n) => n.includes(`aria-label="${label}`))?.match(/data-state="(\w+)"/)?.[1];
    expect(stateOf('Plan the next action')).toBe('active');
    expect(stateOf('Call a tool')).toBe('active');
    expect(stateOf('Check the result')).toBe('active');
    expect(stateOf('Goal from the user')).toBe('dim');
    expect(stateOf('Person approves')).toBe('dim');
    expect(stateOf('Final answer')).toBe('dim');
    // Not colour alone: the name says so too.
    expect(html).toContain('aria-label="Plan the next action, Model, active"');
    expect(html).toContain('aria-label="Person approves, Human"');
    for (const node of nodes) expect(node).toMatch(/role="button" tabindex="0"/);
    for (const label of ['Goal from the', 'Person approves', 'Final answer']) expect(html).toContain(label);
  });

  it('leaves every node neutral when a step singles nothing out', () => {
    const html = view(valid({ ...AGENT_LOOP, steps: [{ id: 's', title: 'Overview', description: 'The whole loop.', illustrative: true }] }));
    expect(count(html, /data-state="neutral"/g)).toBe(6);
  });

  it('animates only edges between active nodes and keeps return edges distinct and labelled', () => {
    const html = view(flow, { stepIndex: 1 });
    // plan -> act and act -> check are live data edges; check -> plan is a live retry.
    expect(count(html, /class="viz-edge-flow"/g)).toBe(2);
    expect(html).toMatch(/<g class="viz-edge" data-kind="retry" data-route="arc" data-active="true">/);
    expect(html).toMatch(/<g class="viz-edge" data-kind="approval" data-route="chain" data-active="false">/);
    expect(html).toContain(`>${EN['learn.edge.retry']}</tspan>`);
    expect(html).toContain('>needs sign-off</tspan>');
    expect(view(flow, { stepIndex: 0 })).toMatch(/data-kind="retry" data-route="arc" data-active="false"/);
  });

  it('shows the step, its position and working Previous and Next controls', () => {
    const first = view(flow);
    expect(first).toContain('Step 1 of 4');
    expect(first).toMatch(/<button type="button" class="btn" aria-disabled="true" aria-label="Previous step">/);
    expect(first).toMatch(/<button type="button" class="btn" aria-disabled="false" aria-label="Next step">/);
    const last = view(flow, { stepIndex: 3 });
    expect(last).toContain('Step 4 of 4');
    expect(last).toContain('A person approves the answer');
    expect(last).toMatch(/aria-disabled="true" aria-label="Next step"/);
    expect(count(last, /aria-current="step"/g)).toBe(1);
    expect(last).toMatch(/aria-current="step"><span class="t-num">4\.<\/span> A person approves the answer/);
  });

  it('clamps a step index that is out of range', () => {
    expect(view(flow, { stepIndex: 99 })).toContain('Step 4 of 4');
    expect(view(flow, { stepIndex: -3 })).toContain('Step 1 of 4');
    expect(view(flow, { stepIndex: Number.NaN })).toContain('Step 1 of 4');
  });

  it('marks illustrative steps', () => {
    expect(view(flow, { stepIndex: 1 })).toContain(`<span class="tag">${EN['learn.stepIllustrative']}</span>`);
    expect(view(flow, { stepIndex: 0 })).not.toContain(`<span class="tag">${EN['learn.stepIllustrative']}</span>`);
    // Two illustrative steps, each marked in the step list and in the text list.
    expect(count(view(flow), /\(illustrative\)/g)).toBe(4);
  });

  it('lists every step under "Read as text"', () => {
    const html = view(flow);
    const details = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    expect(count(details, /<li/g)).toBe(4);
    for (const step of flow.steps) {
      expect(details).toContain(step.title);
      expect(details).toContain(step.description);
    }
    expect(details).toContain(flow.textAlternative);
  });

  it('has a polite caption region for node detail', () => {
    const html = view(flow);
    expect(html).toMatch(/class="viz-caption t-small" aria-live="polite"/);
    expect(html).toContain(EN['learn.nodeHint']);
  });

  it('drops the step list in compact mode and carries the reduced-motion flag', () => {
    const html = view(flow, { compact: true, reducedMotion: true });
    expect(html).not.toContain('viz-step-list');
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('data-reduced-motion="true"');
    expect(html).toContain(EN['learn.readAsText']);
    expect(view(flow)).not.toContain('data-reduced-motion');
  });

  it('draws a simulated image and reveals the highlighted region at the output step', () => {
    const v = valid(MEDICAL_IMAGING);
    const before = view(v, { stepIndex: 0 });
    expect(before).toContain(EN['learn.image.caption']);
    expect(before).toContain(EN['learn.image.input']);
    expect(before).toContain(EN['learn.image.output']);
    expect(before).toMatch(/class="viz-img-region" data-shown="false" aria-hidden="true"/);
    expect(view(v, { stepIndex: 1 })).toMatch(/class="viz-img-region" data-shown="true" aria-hidden="false"/);
    expect(before).not.toMatch(/<image|<img|href=/);
  });

  it('prints chart values with their units and measures bars from zero', () => {
    const html = view(valid(BENCHMARK_CHART));
    expect(html).toContain('92.5 %');
    expect(html).toContain('46.25 %');
    expect(html).toContain('1,200 ms');
    expect(html).toContain('style="left:0%;width:100%"');
    expect(html).toContain('style="left:0%;width:50%"');
    // Different units never share a scale.
    expect(html).toContain('Measured in %');
    expect(html).toContain('Measured in ms');
    expect(html).toContain(EN['learn.chart.zero']);
  });

  it('keeps zero on the scale for negative values', () => {
    const html = view(valid({ ...BENCHMARK_CHART, series: [{ label: 'Up', value: 30 }, { label: 'Down', value: -10 }] }));
    expect(html).toContain('style="left:25%;width:75%"');
    expect(html).toContain('style="left:0%;width:25%"');
    expect(html).toContain('class="viz-bar-zero" style="left:25%"');
  });

  it('renders comparison columns as cards', () => {
    const html = view(valid(MODEL_COMPARISON));
    expect(count(html, /class="viz-column"/g)).toBe(2);
    for (const text of ['Small model', 'Large model', 'Runs on a laptop', 'Handles longer documents']) expect(html).toContain(text);
  });

  it('renders timeline entries with a point each', () => {
    const html = view(valid(RELEASE_TIMELINE), { stepIndex: 1 });
    expect(html).toContain('class="viz-axis"');
    expect(count(html, /<g class="viz-dot" data-state="active">/g)).toBe(2);
    expect(count(html, /<g class="viz-dot" data-state="dim">/g)).toBe(1);
  });
});

describe('StoryPlayer', () => {
  const story = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(StoryPlayer, { explanation: EXPLANATION, t, ...props }));

  it('has a valid fixture', () => {
    expect(parseExplanation(EXPLANATION)).not.toBeNull();
  });

  it('lists all eight scenes in a transcript that needs no playback', () => {
    const html = story();
    const transcript = html.slice(html.lastIndexOf('<details'), html.lastIndexOf('</details>'));
    expect(transcript).toContain(`<summary>${EN['story.transcript']}</summary>`);
    expect(count(transcript, /<h4/g)).toBe(8);
    SCENE_IDS.forEach((id, i) => {
      expect(transcript).toContain(`Scene ${i + 1}: ${SCENE_NAMES[id]}`);
      expect(transcript).toContain(`On screen line ${i + 1}`);
      expect(transcript).toContain(`Narration for scene ${i + 1},`);
    });
    expect(count(transcript, /\(Illustrative\)/g)).toBe(4);
  });

  it('shows the first scene with a progress bar and scene buttons', () => {
    const html = story();
    expect(html).toMatch(/role="progressbar" aria-label="Story progress" aria-valuemin="1" aria-valuemax="8" aria-valuenow="1" aria-valuetext="Scene 1 of 8: The problem"/);
    expect(count(html, /class="story-scene-btn t-num"/g)).toBe(8);
    expect(count(html, /class="story-scene-btn t-num" aria-current="step"/g)).toBe(1);
    expect(html).toContain('aria-label="Scene 8: What is next"');
    expect(html).toContain('<p class="story-onscreen break-anywhere">On screen line 1</p>');
    expect(html).toContain('<h3 class="t-card mt-1">The problem</h3>');
    expect(html).toContain(EN['story.shortcuts']);
    expect(html).toMatch(/<p class="sr-only" aria-live="polite"><\/p>/);
  });

  it('offers the four speeds as a radio group with 1x chosen', () => {
    const html = story();
    expect(html).toContain('role="radiogroup" aria-label="Playback speed"');
    expect(count(html, /role="radio"/g)).toBe(STORY_SPEEDS.length);
    expect(count(html, /role="radio" aria-checked="true"/g)).toBe(1);
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0" class="t-num">1x</);
    for (const speed of ['0.75x', '1x', '1.5x', '2x']) expect(html).toContain(`>${speed}</button>`);
  });

  it('does not start playing by itself', () => {
    const html = story();
    expect(html).toContain('data-playing="false"');
    expect(html).toContain(`</svg>${EN['story.play']}</button>`);
    expect(html).not.toContain(`</svg>${EN['story.pause']}</button>`);
    expect(html).not.toMatch(/autoplay/i);
    // The transcript starts closed when motion is allowed.
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it('replaces Play with manual stepping under reduced motion and opens the transcript', () => {
    const html = story({ reducedMotion: true });
    expect(html).not.toContain(`</svg>${EN['story.play']}</button>`);
    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain(EN['story.previous']);
    expect(html).toContain(EN['story.next']);
    expect(html).toContain(EN['story.manual']);
    expect(html).toContain(EN['story.restart']);
    expect(html).toMatch(/<details class="viz-text" open="">\s*<summary>Transcript/);
    expect(html).toContain('data-reduced-motion="true"');
  });

  it('opens on the requested scene and shows the diagram at that scene’s step', () => {
    const html = story({ initialScene: 2 });
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('<h3 class="t-card mt-1">Under the hood</h3>');
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('Step 2 of 4');
    expect(html).toContain('aria-label="Call a tool, Tool, active"');
    expect(story({ initialScene: 3 })).toContain('Step 3 of 4');
    // Scenes without a step have no diagram.
    expect(story({ initialScene: 0 })).not.toContain('viz-svg');
    expect(story({ initialScene: 99 })).toContain('aria-valuenow="8"');
    expect(story({ initialScene: -1 })).toContain('aria-valuenow="1"');
  });

  it('marks illustrative scenes', () => {
    expect(story({ initialScene: 1 })).toContain(`<span class="tag">${EN['story.illustrative']}</span>`);
    expect(story({ initialScene: 0 })).not.toContain(`<span class="tag">${EN['story.illustrative']}</span>`);
  });

  it('shows a note instead of a player for invalid data', () => {
    for (const raw of [null, {}, { ...EXPLANATION, scenes: EXPLANATION.scenes.slice(0, 3) }, { ...EXPLANATION, scenes: EXPLANATION.scenes.map((s) => ({ ...s, narration: '<script>x</script>' })) }]) {
      const html = story({ explanation: raw });
      expect(html).toContain(EN['learn.unavailable']);
      expect(html).not.toContain('progressbar');
      expect(html).not.toContain('<script');
    }
  });

  it('derives the time on each scene from how much there is to read', () => {
    const short = { narration: 'Short.', onScreen: 'Hi' };
    const long = { narration: Array.from({ length: 90 }, () => 'word').join(' '), onScreen: 'A longer line on screen' };
    expect(sceneDwellMs(short)).toBe(4000);
    expect(sceneDwellMs(long)).toBeGreaterThan(30_000);
    expect(sceneDwellMs(long)).toBeLessThan(40_000);
    expect(Math.abs(sceneDwellMs(long, 2) - sceneDwellMs(long) / 2)).toBeLessThanOrEqual(1);
    expect(sceneDwellMs(long, 0.75)).toBeGreaterThan(sceneDwellMs(long));
    expect(sceneDwellMs({ ...long, stepId: 'work' })).toBe(sceneDwellMs(long) + 2500);
    expect(sceneDwellMs(long, 0)).toBe(sceneDwellMs(long));
  });
});

describe('LayerView', () => {
  const layers = (layerId?: LayerId, explanation: unknown = EXPLANATION) => renderToStaticMarkup(createElement(LayerView, { explanation: explanation as Explanation, layerId, t }));

  it('is a tablist over the five layers with one selected tab and a labelled panel', () => {
    const html = layers();
    expect(html).toContain('role="tablist" aria-label="Ways to explain it"');
    expect(count(html, /role="tab"/g)).toBe(5);
    expect(count(html, /aria-selected="true"/g)).toBe(1);
    expect(count(html, /tabindex="-1"/g)).toBe(4);
    for (const id of LAYER_IDS) expect(html).toContain(`>${LAYER_NAMES[id]}</button>`);
    const tabId = html.match(/role="tab" id="([^"]+)" aria-selected="true"/)?.[1];
    expect(tabId).toBeTruthy();
    expect(html).toContain(`role="tabpanel"`);
    expect(html).toContain(`aria-labelledby="${tabId}"`);
  });

  it('keeps what the sources say apart from the general explanation', () => {
    const html = layers('simple');
    const evidence = html.slice(html.indexOf('data-source="evidence"'), html.indexOf('data-source="concept"'));
    const concept = html.slice(html.indexOf('data-source="concept"'));
    expect(evidence).toContain(EN['learn.layer.evidence']);
    expect(evidence).toContain('The README says the tool plans and runs tasks by itself.');
    expect(evidence).not.toContain('An agent is a program');
    expect(concept).toContain(EN['learn.layer.concept']);
    expect(concept).toContain(EN['learn.layer.conceptNote']);
    expect(concept).toContain('An agent is a program that decides its own next step.');
    expect(concept).not.toContain('The README says');
    expect(html).toContain('class="layer-evidence"');
    expect(html).toContain('class="layer-concept"');
    expect(html).toContain('The sources do not say how often it fails.');
    expect(html).toContain(`${EN['learn.layer.caveat']}:`);
  });

  it('shows only the block that has content', () => {
    const analogy = layers('analogy');
    expect(analogy).not.toContain('data-source="evidence"');
    expect(analogy).toContain('Think of a cook');
    const how = layers('how');
    expect(how).not.toContain('data-source="concept"');
    expect(how).toContain('planner and a tool runner');
    expect(how).toMatch(/aria-selected="true"[^>]*>How it works</);
  });

  it('says so when a layer has neither', () => {
    const html = layers('deep');
    expect(html).toContain('The sources do not cover this, and no general explanation applies.');
    expect(html).not.toContain('data-source=');
  });

  it('shows a note for invalid data and ignores an unknown layer id', () => {
    expect(layers('simple', { nope: true })).toContain(EN['learn.unavailable']);
    expect(layers('bogus' as LayerId)).toMatch(/aria-selected="true"[^>]*>Explain it simply</);
  });
});
