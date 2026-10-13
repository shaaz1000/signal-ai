import { describe, expect, it } from 'vitest';
import { chainOrder, fitLayout, HORIZONTAL_MIN_WIDTH, LABEL_FONT, layerNodes, layoutDiagram, NODE_FONT, textUnits, wrapLabel, type DiagramLayout, type Orientation, type Rect } from '@/lib/explain/layout';
import { NODE_KINDS, parseVisualization, type DiagramType, type Visualization } from '@/lib/explain/schema';

const LABELS = ['Goal', 'Plan the next action', 'Call a tool', 'Read the result and decide what to do next', 'Ask a person to approve', 'Write the final answer for the user here', 'Store'];
const SVG_TYPES: DiagramType[] = ['flow', 'process', 'network', 'timeline', 'image-analysis'];
const WIDTHS = [200, 318, 358, 600, 760, 1100];
const COUNTS = [2, 3, 7, 14];
const ORIENTATIONS: Orientation[] = ['horizontal', 'vertical'];

/** A chain of `n` nodes with every awkward edge the schema allows: retry, feedback, approval, a skip and a self-loop. */
function build(diagramType: DiagramType, n: number): Visualization {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: LABELS[i % LABELS.length], detail: `Detail for part ${i + 1}.`, kind: NODE_KINDS[i % NODE_KINDS.length] }));
  const edges: { from: string; to: string; kind?: string; label?: string }[] = [];
  for (let i = 0; i < n - 1; i++) edges.push({ from: `n${i}`, to: `n${i + 1}`, kind: i === 1 ? 'approval' : 'data', ...(i === 0 ? { label: 'the request as written' } : {}) });
  edges.push({ from: `n${n - 1}`, to: 'n0', kind: 'retry', label: 'try again' });
  if (n > 2) {
    edges.push({ from: `n${n - 1}`, to: 'n1', kind: 'feedback' });
    edges.push({ from: 'n0', to: 'n2' });
    edges.push({ from: 'n1', to: 'n1', kind: 'retry' });
  }
  const parsed = parseVisualization({
    id: `${diagramType}-${n}`, title: `Fixture ${diagramType} ${n}`, diagramType, nodes, edges,
    steps: [{ id: 's1', title: 'First', description: 'The first step.', focus: ['n0', 'n1'], illustrative: true }],
    confirmed: false, textAlternative: 'A chain of parts with a retry back to the start.',
  });
  if (!parsed) throw new Error(`fixture ${diagramType}/${n} is not a valid visualization`);
  return parsed;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const numbers = (text: string) => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

function expectSound(layout: DiagramLayout, v: Visualization) {
  expect(layout.nodes.map((n) => n.id).sort()).toEqual(v.nodes.map((n) => n.id).sort());
  for (const [i, a] of layout.nodes.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(layout.width + 0.01);
    expect(a.y + a.height).toBeLessThanOrEqual(layout.height + 0.01);
    // Touch target and room for three lines of 13px text.
    expect(a.height).toBeGreaterThanOrEqual(44);
    expect(a.width).toBeGreaterThanOrEqual(120);
    expect(a.lines.length).toBeGreaterThanOrEqual(1);
    expect(a.lines.length).toBeLessThanOrEqual(3);
    for (const b of layout.nodes.slice(i + 1)) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    if (layout.zones) for (const frame of [layout.zones.input, layout.zones.output]) expect(overlaps(a, frame), `${a.id} overlaps a frame`).toBe(false);
  }
  for (const e of layout.edges) {
    // Control points count too, so a curve can never leave the viewBox.
    const coords = [...numbers(e.d), ...numbers(e.arrow), e.labelX, e.labelY];
    expect(coords.length % 2).toBe(0);
    coords.forEach((value, i) => {
      expect(Number.isFinite(value)).toBe(true);
      expect(value, `${e.key} ${e.route}`).toBeGreaterThanOrEqual(-0.01);
      expect(value, `${e.key} ${e.route}`).toBeLessThanOrEqual((i % 2 === 0 ? layout.width : layout.height) + 0.01);
    });
  }
}

describe('wrapLabel', () => {
  it('keeps short text on one line', () => {
    expect(wrapLabel('Plan', 16)).toEqual(['Plan']);
  });

  it('wraps at word boundaries without exceeding the width', () => {
    const lines = wrapLabel('Read the result and decide what to do next', 16);
    expect(lines).toEqual(['Read the result', 'and decide what', 'to do next']);
    for (const line of lines) expect(textUnits(line)).toBeLessThanOrEqual(16);
  });

  it('never returns more than three lines and marks what was cut', () => {
    const lines = wrapLabel('one two three four five six seven eight nine ten eleven twelve', 10);
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith('…')).toBe(true);
    for (const line of lines) expect(textUnits(line)).toBeLessThanOrEqual(10);
  });

  it('breaks a word that is longer than a line', () => {
    const lines = wrapLabel('Supercalifragilistic', 8);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('').replace('…', '')).toBe('Supercalifragilistic'.slice(0, lines.join('').replace('…', '').length));
    for (const line of lines) expect(textUnits(line)).toBeLessThanOrEqual(8);
  });

  it('counts wide scripts as two columns', () => {
    for (const line of wrapLabel('画像を解析して結果を返すモデル', 10)) expect(textUnits(line)).toBeLessThanOrEqual(10);
  });

  it('honours a smaller line limit and survives odd input', () => {
    expect(wrapLabel('a b c d e f g h i j k l m n o p', 4, 2)).toHaveLength(2);
    expect(wrapLabel('', 10)).toEqual(['']);
    expect(wrapLabel('   ', 10)).toEqual(['']);
    expect(wrapLabel('word', Number.NaN).length).toBeGreaterThanOrEqual(1);
    expect(wrapLabel('word', -5).length).toBeGreaterThanOrEqual(1);
  });
});

describe('layoutDiagram', () => {
  it.each(SVG_TYPES.flatMap((type) => COUNTS.flatMap((n) => ORIENTATIONS.map((orientation) => [type, n, orientation] as const))))('%s with %i nodes, %s: every node placed, none overlapping, all inside the viewBox', (type, n, orientation) => {
    const v = build(type, n);
    for (const width of WIDTHS) {
      const layout = layoutDiagram(v, { orientation, width });
      expect(layout.width).toBeGreaterThanOrEqual(width);
      expect(layout.height).toBeGreaterThan(0);
      expectSound(layout, v);
    }
  });

  it('is deterministic', () => {
    for (const type of SVG_TYPES) {
      const a = layoutDiagram(build(type, 14), { orientation: 'horizontal', width: 760 });
      const b = layoutDiagram(build(type, 14), { orientation: 'horizontal', width: 760 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('returns an empty layout for the HTML diagram types', () => {
    const v = parseVisualization({ id: 'c', title: 'Chart', diagramType: 'chart', series: [{ label: 'A', value: 1 }], steps: [{ id: 's', title: 'S', description: 'D', illustrative: false }], confirmed: true, textAlternative: 'One value.' })!;
    const layout = layoutDiagram(v, { orientation: 'horizontal', width: 600 });
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  it('copes with nonsense options', () => {
    const v = build('flow', 5);
    for (const width of [Number.NaN, -10, 0, Number.POSITIVE_INFINITY, 1e9]) expectSound(layoutDiagram(v, { orientation: 'sideways' as Orientation, width }), v);
  });
});

describe('flow and process layout', () => {
  it('follows edge order from the first node', () => {
    const v = parseVisualization({
      id: 'order', title: 'Order', diagramType: 'flow',
      nodes: [{ id: 'start', label: 'Start' }, { id: 'late', label: 'Late' }, { id: 'early', label: 'Early' }, { id: 'orphan', label: 'Orphan' }],
      edges: [{ from: 'start', to: 'early' }, { from: 'early', to: 'late' }, { from: 'late', to: 'start', kind: 'retry' }],
      steps: [{ id: 's', title: 'S', description: 'D', illustrative: true }], confirmed: false, textAlternative: 'Start, early, late.',
    })!;
    expect(chainOrder(v.nodes, v.edges)).toEqual(['start', 'early', 'late', 'orphan']);
    const layout = layoutDiagram(v, { orientation: 'horizontal', width: 900 });
    expect(layout.nodes.map((n) => n.id)).toEqual(['start', 'early', 'late', 'orphan']);
    const xs = layout.nodes.map((n) => n.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(layout.nodes.map((n) => n.y)).size).toBe(1);
  });

  it('stacks the chain top to bottom when vertical', () => {
    const layout = layoutDiagram(build('process', 7), { orientation: 'vertical', width: 318 });
    expect(new Set(layout.nodes.map((n) => n.x)).size).toBe(1);
    const ys = layout.nodes.map((n) => n.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('draws steps straight and returns as curves, and keeps each edge kind', () => {
    for (const orientation of ORIENTATIONS) {
      const layout = layoutDiagram(build('flow', 5), { orientation, width: 900 });
      const edge = (from: string, to: string) => layout.edges.find((e) => e.from === from && e.to === to)!;
      expect(edge('n0', 'n1')).toMatchObject({ route: 'chain', kind: 'data', label: 'the request as written' });
      expect(edge('n1', 'n2')).toMatchObject({ route: 'chain', kind: 'approval' });
      expect(edge('n4', 'n0')).toMatchObject({ route: 'arc', kind: 'retry', label: 'try again' });
      expect(edge('n4', 'n1')).toMatchObject({ route: 'arc', kind: 'feedback' });
      expect(edge('n0', 'n2')).toMatchObject({ route: 'arc', kind: 'data' });
      expect(edge('n1', 'n1')).toMatchObject({ route: 'loop' });
      expect(edge('n0', 'n1').d).not.toContain('C');
      expect(edge('n4', 'n0').d).toContain('C');
      expect(layout.edges).toHaveLength(8);
    }
  });

  it('wraps a long chain onto several rows instead of shrinking it', () => {
    const layout = layoutDiagram(build('flow', 14), { orientation: 'horizontal', width: 760 });
    expect(layout.width).toBe(760);
    expect(new Set(layout.nodes.map((n) => n.y)).size).toBeGreaterThan(1);
  });

  it('terminates on a cycle of plain data edges', () => {
    const v = parseVisualization({
      id: 'loop', title: 'Loop', diagramType: 'flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'b', to: 'a' }, { from: 'a', to: 'a' }],
      steps: [{ id: 's', title: 'S', description: 'D', illustrative: true }], confirmed: false, textAlternative: 'A loop.',
    })!;
    for (const orientation of ORIENTATIONS) expectSound(layoutDiagram(v, { orientation, width: 600 }), v);
  });
});

describe('network layout', () => {
  const net = (edges: [string, string, string?][], ids = ['a', 'b', 'c', 'd']) => parseVisualization({
    id: 'net', title: 'Net', diagramType: 'network', nodes: ids.map((id) => ({ id, label: id.toUpperCase() })),
    edges: edges.map(([from, to, kind]) => ({ from, to, kind: kind ?? 'data' })),
    steps: [{ id: 's', title: 'S', description: 'D', illustrative: true }], confirmed: false, textAlternative: 'A small graph.',
  })!;

  it('ranks each node by its longest path from a source', () => {
    const v = net([['a', 'b'], ['a', 'c'], ['b', 'c'], ['c', 'd']]);
    expect(layerNodes(v.nodes, v.edges)).toEqual([0, 1, 2, 3]);
    const layout = layoutDiagram(v, { orientation: 'horizontal', width: 900 });
    const xs = layout.nodes.map((n) => n.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(xs[2]).toBeLessThan(xs[3]);
  });

  it('puts siblings in the same layer', () => {
    const v = net([['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]);
    expect(layerNodes(v.nodes, v.edges)).toEqual([0, 1, 1, 2]);
    const vertical = layoutDiagram(v, { orientation: 'vertical', width: 358 });
    const byId = new Map(vertical.nodes.map((n) => [n.id, n]));
    expect(byId.get('b')!.y).toBe(byId.get('c')!.y);
    expect(byId.get('a')!.y).toBeLessThan(byId.get('b')!.y);
    expect(byId.get('b')!.y).toBeLessThan(byId.get('d')!.y);
  });

  it('tolerates cycles, self-loops and return edges', () => {
    const v = net([['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd'], ['d', 'b', 'feedback'], ['d', 'd'], ['b', 'a']]);
    const layers = layerNodes(v.nodes, v.edges);
    expect(layers).toHaveLength(4);
    for (const l of layers) expect(l).toBeGreaterThanOrEqual(0);
    expect(Math.max(...layers)).toBeLessThan(4);
    for (const orientation of ORIENTATIONS) {
      const layout = layoutDiagram(v, { orientation, width: 700 });
      expectSound(layout, v);
      expect(layout.edges).toHaveLength(7);
    }
  });

  it('sends edges that span layers round the outside instead of through the nodes between', () => {
    const v = net([['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'c'], ['d', 'a', 'retry'], ['c', 'b', 'feedback']]);
    for (const orientation of ORIENTATIONS) {
      const layout = layoutDiagram(v, { orientation, width: orientation === 'vertical' ? 318 : 900 });
      expectSound(layout, v);
      const edge = (from: string, to: string) => layout.edges.find((e) => e.from === from && e.to === to)!;
      expect(edge('a', 'b').route).toBe('link');
      expect(edge('c', 'b').route).toBe('link');
      for (const [from, to] of [['a', 'c'], ['d', 'a']]) {
        const e = edge(from, to);
        expect(e.route).toBe('arc');
        // Sample the curve: no point of it may fall inside a node it does not start or end at.
        const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers(e.d);
        for (let i = 1; i < 20; i++) {
          const u = i / 20;
          const w = [(1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3];
          const x = w[0] * x0 + w[1] * x1 + w[2] * x2 + w[3] * x3;
          const y = w[0] * y0 + w[1] * y1 + w[2] * y2 + w[3] * y3;
          for (const n of layout.nodes) if (n.id !== from && n.id !== to) expect(x > n.x && x < n.x + n.width && y > n.y && y < n.y + n.height, `${from}->${to} crosses ${n.id}`).toBe(false);
        }
      }
    }
  });

  it('handles a fully connected cyclic graph of fourteen nodes', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `n${i}`);
    const edges = ids.flatMap((from, i) => [[from, ids[(i + 1) % 14]], [from, ids[(i + 5) % 14]]] as [string, string][]).slice(0, 24);
    const v = net(edges, ids);
    for (const orientation of ORIENTATIONS) for (const width of WIDTHS) expectSound(layoutDiagram(v, { orientation, width }), v);
  });
});

describe('timeline layout', () => {
  it('spaces the points evenly along one line, in order', () => {
    for (const orientation of ORIENTATIONS) {
      const layout = layoutDiagram(build('timeline', 7), { orientation, width: orientation === 'horizontal' ? 900 : 318 });
      const along = layout.nodes.map((n) => (orientation === 'horizontal' ? n.dot!.x : n.dot!.y));
      const across = layout.nodes.map((n) => (orientation === 'horizontal' ? n.dot!.y : n.dot!.x));
      expect(new Set(across).size).toBe(1);
      const gaps = along.slice(1).map((value, i) => value - along[i]);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeCloseTo(gaps[0], 0);
      }
      expect(layout.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
      expect(layout.axis).not.toBeNull();
      expect(layout.edges).toEqual([]);
    }
  });
});

describe('image analysis layout', () => {
  const v = parseVisualization({
    id: 'scan', title: 'Reading an image', diagramType: 'image-analysis',
    nodes: [{ id: 'image', label: 'Image', kind: 'input' }, { id: 'model', label: 'Vision model', kind: 'model' }, { id: 'finding', label: 'Marked region', kind: 'output' }, { id: 'reviewer', label: 'Radiologist reviews', kind: 'human' }],
    edges: [{ from: 'image', to: 'model' }, { from: 'model', to: 'finding' }, { from: 'finding', to: 'reviewer', kind: 'approval' }],
    steps: [{ id: 's', title: 'S', description: 'D', illustrative: true }], confirmed: false, textAlternative: 'An image goes in, a region comes out.',
  })!;

  it('lays out input, model and output zones left to right', () => {
    const layout = layoutDiagram(v, { orientation: 'horizontal', width: 800 });
    expectSound(layout, v);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get('image')!.x).toBeLessThan(byId.get('model')!.x);
    expect(byId.get('model')!.x).toBeLessThan(byId.get('finding')!.x);
    expect(byId.get('reviewer')!.x).toBe(byId.get('finding')!.x);
    expect(byId.get('reviewer')!.y).toBeGreaterThan(byId.get('finding')!.y);
    expect(layout.zones!.input.x).toBeLessThan(layout.zones!.output.x);
  });

  it('stacks the zones when vertical and keeps the highlighted region inside the output frame', () => {
    for (const orientation of ORIENTATIONS) {
      const layout = layoutDiagram(v, { orientation, width: orientation === 'vertical' ? 318 : 800 });
      expectSound(layout, v);
      const { input, output, region } = layout.zones!;
      expect(overlaps(input, output)).toBe(false);
      expect(region.x).toBeGreaterThanOrEqual(output.x);
      expect(region.y).toBeGreaterThanOrEqual(output.y);
      expect(region.x + region.width).toBeLessThanOrEqual(output.x + output.width);
      expect(region.y + region.height).toBeLessThanOrEqual(output.y + output.height);
    }
    const vertical = layoutDiagram(v, { orientation: 'vertical', width: 318 });
    expect(vertical.zones!.input.y).toBeLessThan(vertical.zones!.output.y);
  });
});

describe('fitLayout', () => {
  it('never needs horizontal scrolling at phone width, so text is drawn at its real size', () => {
    expect(NODE_FONT).toBeGreaterThanOrEqual(12);
    expect(LABEL_FONT).toBeGreaterThanOrEqual(12);
    // 390px viewport, minus 16px page gutters, minus the 12px frame padding and borders.
    for (const type of SVG_TYPES) for (const n of COUNTS) for (const width of [318, 330, 358]) {
      const v = build(type, n);
      const layout = fitLayout(v, width);
      expect(layout.width, `${type}/${n}/${width}`).toBeLessThanOrEqual(width);
      expectSound(layout, v);
    }
  });

  it('goes horizontal when there is room and falls back to vertical when there is not', () => {
    expect(fitLayout(build('flow', 5), 900).orientation).toBe('horizontal');
    expect(fitLayout(build('flow', 5), HORIZONTAL_MIN_WIDTH - 1).orientation).toBe('vertical');
    expect(fitLayout(build('timeline', 3), 900).orientation).toBe('horizontal');
    expect(fitLayout(build('timeline', 14), 600).orientation).toBe('vertical');
    for (const type of SVG_TYPES) for (const n of COUNTS) for (const width of [560, 760, 1100]) expect(fitLayout(build(type, n), width).width).toBeLessThanOrEqual(width);
  });
});
