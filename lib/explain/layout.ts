/**
 * Diagram geometry for the Learn visualizations. Pure and deterministic: the
 * same visualization and options always give the same numbers, so the server
 * render and the browser agree. Coordinates are CSS pixels because diagrams
 * are drawn at 1:1 (the viewBox is as wide as the container), which is what
 * keeps SVG text at its stated size on a phone instead of shrinking it.
 * Narrow containers get a vertical layout rather than a scaled-down one.
 */
import type { DiagramEdge, DiagramNode, DiagramType, Visualization } from './model';

export type Orientation = 'horizontal' | 'vertical';
export interface LayoutOptions { orientation: Orientation; width: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface NodeBox extends Rect {
  id: string;
  label: string;
  kind: DiagramNode['kind'];
  /** The label wrapped for this box, at most three lines. */
  lines: string[];
  /** Timeline only: the point on the axis this entry belongs to. */
  dot: { x: number; y: number } | null;
}

/** `chain` is a straight step along the flow, `arc` a curved return or skip, `loop` a node feeding itself, `link` a graph edge. */
export type EdgeRoute = 'chain' | 'arc' | 'loop' | 'link';
export interface EdgePath {
  key: string;
  from: string;
  to: string;
  kind: DiagramEdge['kind'];
  label: string | null;
  d: string;
  /** Arrowhead triangle as SVG polygon points. Computed here so no `<marker>` ids are needed. */
  arrow: string;
  route: EdgeRoute;
  labelX: number;
  labelY: number;
  /** Where the label block sits relative to (labelX, labelY). */
  labelAlign: 'above' | 'below' | 'center';
  labelChars: number;
}

export interface DiagramLayout {
  diagramType: DiagramType;
  orientation: Orientation;
  width: number;
  height: number;
  nodes: NodeBox[];
  edges: EdgePath[];
  /** True when any node has a kind worth naming, so every box reserves a line for it. */
  kindLine: boolean;
  /** Timeline only. */
  axis: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Image analysis only: the two simulated frames and the region highlighted in the output. */
  zones: { input: Rect; output: Rect; region: Rect } | null;
}

export const NODE_FONT = 13;
export const LABEL_FONT = 12;
export const LINE_HEIGHT = 17;
export const KIND_HEIGHT = 16;
/** Containers at least this wide try the horizontal layout first. */
export const HORIZONTAL_MIN_WIDTH = 560;
/** Used before the container has been measured (server render). Fits a 390px phone inside page and card padding. */
export const DEFAULT_WIDTH = 318;

// Average advance of the label faces, rounded up so wrapped text does not overrun its box.
const CHAR_W = 7.2;
const LABEL_CHAR_W = 6.6;
const PAD_X = 10;
const PAD_Y = 11;
const MIN_NODE_H = 44;
const ARC_SPACE = 58;
const LABEL_SPACE = 30;
// Room under the last row for a self-loop and its caption.
const LOOP_SPACE = 22;

const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isReturn = (e: DiagramEdge) => e.kind === 'feedback' || e.kind === 'retry';
// Edges other than plain data flow are always captioned (with their own label or the name of their kind).
const isLabelled = (e: DiagramEdge) => Boolean(e.label) || e.kind !== 'data';

// East Asian scripts are roughly twice as wide as Latin at the same size.
const isWide = (ch: string) => (ch.codePointAt(0) ?? 0) >= 0x2e80;
export function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += isWide(ch) ? 2 : 1;
  return units;
}

function splitAt(word: string, max: number): [string, string] {
  const chars = Array.from(word);
  let units = 0;
  let i = 0;
  for (; i < chars.length; i++) {
    const w = isWide(chars[i]) ? 2 : 1;
    if (i > 0 && units + w > max) break;
    units += w;
  }
  return [chars.slice(0, i).join(''), chars.slice(i).join('')];
}

function ellipsize(line: string, max: number): string {
  const chars = Array.from(line);
  while (chars.length > 1 && textUnits(chars.join('')) + 1 > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/**
 * Greedy word wrap for SVG text, which cannot wrap itself. Words longer than a
 * line are broken; text beyond `maxLines` (three by default) ends in an ellipsis.
 */
export function wrapLabel(text: string, maxChars: number, maxLines = 3): string[] {
  const max = Math.max(4, Number.isFinite(maxChars) ? Math.floor(maxChars) : 4);
  const limit = Math.max(1, Math.floor(maxLines) || 1);
  const lines: string[] = [];
  let line = '';
  for (let word of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    while (word) {
      const joined = line ? `${line} ${word}` : word;
      if (textUnits(joined) <= max) { line = joined; word = ''; }
      else if (line) { lines.push(line); line = ''; }
      else { const [head, rest] = splitAt(word, max); lines.push(head); word = rest; }
    }
  }
  if (line) lines.push(line);
  if (lines.length === 0) return [''];
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit - 1), ellipsize(lines[limit - 1], max)];
}

interface Sizing { lines: Map<string, string[]>; height: number; kindLine: boolean }
function sizeNodes(nodes: DiagramNode[], nodeWidth: number): Sizing {
  const maxChars = Math.floor((nodeWidth - PAD_X * 2) / CHAR_W);
  const lines = new Map<string, string[]>();
  let most = 1;
  for (const n of nodes) {
    const wrapped = wrapLabel(n.label, maxChars);
    lines.set(n.id, wrapped);
    most = Math.max(most, wrapped.length);
  }
  const kindLine = nodes.some((n) => n.kind !== 'process');
  return { lines, kindLine, height: Math.max(MIN_NODE_H, PAD_Y * 2 + most * LINE_HEIGHT + (kindLine ? KIND_HEIGHT : 0)) };
}

function place(node: DiagramNode, sizing: Sizing, x: number, y: number, width: number): NodeBox {
  return { id: node.id, label: node.label, kind: node.kind, lines: sizing.lines.get(node.id) ?? [node.label], x: round(x), y: round(y), width: round(width), height: sizing.height, dot: null };
}

const cx = (b: Rect) => b.x + b.width / 2;
const cy = (b: Rect) => b.y + b.height / 2;
const right = (b: Rect) => b.x + b.width;
const bottom = (b: Rect) => b.y + b.height;

function arrow(x: number, y: number, ux: number, uy: number): string {
  const bx = x - ux * 8;
  const by = y - uy * 8;
  const px = -uy * 4.5;
  const py = ux * 4.5;
  return `${round(x)},${round(y)} ${round(bx + px)},${round(by + py)} ${round(bx - px)},${round(by - py)}`;
}

type Geometry = Pick<EdgePath, 'd' | 'arrow' | 'route' | 'labelX' | 'labelY' | 'labelAlign' | 'labelChars'>;
function edgePath(e: DiagramEdge, index: number, g: Geometry): EdgePath {
  return { key: `${index}-${e.from}-${e.to}`, from: e.from, to: e.to, kind: e.kind, label: e.label ?? null, ...g, labelX: round(g.labelX), labelY: round(g.labelY) };
}

/** A straight-sided route with rounded corners, used where an arc would cut across other rows. */
function roundedPath(points: [number, number][], radius = 10): string {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  let d = `M ${round(pts[0][0])},${round(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    d += ` L ${round(x - ((x - px) / inLen) * r)},${round(y - ((y - py) / inLen) * r)} Q ${round(x)},${round(y)} ${round(x + ((nx - x) / outLen) * r)},${round(y + ((ny - y) / outLen) * r)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${round(last[0])},${round(last[1])}`;
}

/** A node feeding itself: a small loop under its bottom-right corner (or on its right side in a single column). */
function loopGeometry(b: NodeBox, side: 'bottom' | 'right', lane: number): Geometry {
  if (side === 'right') {
    const x = right(b);
    const y = cy(b);
    return { d: `M ${round(x)},${round(y - 10)} C ${round(x + 22)},${round(y - 10)} ${round(x + 22)},${round(y + 10)} ${round(x)},${round(y + 10)}`, arrow: arrow(x, y + 10, -1, 0), route: 'loop', labelX: x + lane / 2 + 8, labelY: y, labelAlign: 'center', labelChars: Math.floor((lane - 24) / LABEL_CHAR_W) };
  }
  const x = right(b);
  const y = bottom(b);
  return { d: `M ${round(x - 32)},${round(y)} C ${round(x - 32)},${round(y + 20)} ${round(x - 10)},${round(y + 20)} ${round(x - 10)},${round(y)}`, arrow: arrow(x - 10, y, 0, -1), route: 'loop', labelX: x - 21, labelY: y + 29, labelAlign: 'below', labelChars: Math.max(8, Math.floor(b.width / LABEL_CHAR_W)) };
}

/** A smooth connection between two boxes that leaves and enters on the sides facing each other. */
function linkGeometry(a: NodeBox, b: NodeBox, orientation: Orientation, offset: number): Geometry {
  const xOverlap = a.x < right(b) && b.x < right(a);
  const yOverlap = a.y < bottom(b) && b.y < bottom(a);
  let sx: number, sy: number, ex: number, ey: number, d: string, head: string;
  if (!yOverlap && (orientation === 'vertical' || xOverlap)) {
    const down = cy(b) > cy(a);
    sx = cx(a) + offset; sy = down ? bottom(a) : a.y;
    ex = cx(b) + offset; ey = down ? b.y : bottom(b);
    const c = Math.max(14, Math.abs(ey - sy) / 2) * (down ? 1 : -1);
    d = `M ${round(sx)},${round(sy)} C ${round(sx)},${round(sy + c)} ${round(ex)},${round(ey - c)} ${round(ex)},${round(ey)}`;
    head = arrow(ex, ey, 0, down ? 1 : -1);
  } else {
    const forward = cx(b) > cx(a);
    sx = forward ? right(a) : a.x; sy = cy(a) + offset;
    ex = forward ? b.x : right(b); ey = cy(b) + offset;
    const c = Math.max(14, Math.abs(ex - sx) / 2) * (forward ? 1 : -1);
    d = `M ${round(sx)},${round(sy)} C ${round(sx + c)},${round(sy)} ${round(ex - c)},${round(ey)} ${round(ex)},${round(ey)}`;
    head = arrow(ex, ey, forward ? 1 : -1, 0);
  }
  return { d, arrow: head, route: 'link', labelX: (sx + ex) / 2, labelY: (sy + ey) / 2, labelAlign: 'center', labelChars: 14 };
}

function knownEdges(v: Visualization): { edge: DiagramEdge; index: number }[] {
  const ids = new Set(v.nodes.map((n) => n.id));
  return v.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => ids.has(edge.from) && ids.has(edge.to));
}

/** Reading order of a flow: follow forward edges from the first node, in the order the edges are listed. */
export function chainOrder(nodes: DiagramNode[], edges: DiagramEdge[]): string[] {
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (!isReturn(e) && e.from !== e.to && out.has(e.to)) out.get(e.from)?.push(e.to);
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const next of out.get(id) ?? []) visit(next);
  };
  for (const n of nodes) visit(n.id);
  return order;
}

function layoutChain(v: Visualization, opt: LayoutOptions): DiagramLayout {
  const edges = knownEdges(v);
  const order = chainOrder(v.nodes, edges.map((e) => e.edge));
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const pos = new Map(order.map((id, i) => [id, i]));
  const n = order.length;

  // A forward step to the next node in reading order is a straight connector; everything else curves around the flow.
  const taken = new Set<string>();
  const classes = edges.map(({ edge: e }) => {
    if (e.from === e.to) return 'loop' as const;
    const a = pos.get(e.from) ?? 0;
    const b = pos.get(e.to) ?? 0;
    if (b === a + 1 && !isReturn(e) && !taken.has(e.from)) { taken.add(e.from); return 'chain' as const; }
    return b < a ? ('back' as const) : ('forward' as const);
  });
  const hasBack = classes.includes('back');
  const hasForward = classes.includes('forward');
  const hasLoop = classes.includes('loop');
  const hasChainLabel = edges.some(({ edge }, i) => classes[i] === 'chain' && isLabelled(edge));

  const gapX = 40;
  const minW = 124;
  const fit = (pad: number) => Math.floor((opt.width - pad * 2 + gapX) / (minW + gapX));
  let perRow = opt.orientation === 'vertical' ? 1 : clamp(fit(16), 1, n);
  // More than one row needs side lanes for returns that span rows, which can cost a column.
  if (perRow > 1 && n > perRow) perRow = clamp(fit(30), 1, n);

  const boxes = new Map<string, NodeBox>();
  const out: EdgePath[] = [];
  let width: number;
  let height: number;

  if (perRow < 2) {
    // One column. Returns arc down the right-hand lane, skips down the left.
    const pad = 12;
    const wantR = hasBack || hasLoop;
    // Lanes give way before the nodes do, so a phone-width diagram with arcs on both sides still fits without scrolling.
    const lane = clamp((opt.width - pad * 2 - 150) / (Number(wantR) + Number(hasForward) || 1), 64, 100);
    const laneR = wantR ? lane : 0;
    const laneL = hasForward ? lane : 0;
    const nodeW = clamp(opt.width - pad * 2 - laneL - laneR, 120, 320);
    width = Math.max(opt.width, nodeW + pad * 2 + laneL + laneR);
    const x = pad + laneL + (width - pad * 2 - laneL - laneR - nodeW) / 2;
    const sizing = sizeNodes(v.nodes, nodeW);
    const rowGap = hasChainLabel ? 48 : 32;
    order.forEach((id, i) => boxes.set(id, place(byId.get(id)!, sizing, x, 16 + i * (sizing.height + rowGap), nodeW)));
    height = 32 + n * sizing.height + (n - 1) * rowGap;

    edges.forEach(({ edge: e, index }, i) => {
      const a = boxes.get(e.from)!;
      const b = boxes.get(e.to)!;
      const kind = classes[i];
      if (kind === 'loop') out.push(edgePath(e, index, loopGeometry(a, 'right', laneR)));
      else if (kind === 'chain') {
        out.push(edgePath(e, index, { d: `M ${round(cx(a))},${round(bottom(a))} L ${round(cx(b))},${round(b.y)}`, arrow: arrow(cx(b), b.y, 0, 1), route: 'chain', labelX: cx(a), labelY: (bottom(a) + b.y) / 2, labelAlign: 'center', labelChars: clamp(Math.floor((nodeW - 8) / LABEL_CHAR_W), 10, 30) }));
      } else {
        const back = kind === 'back';
        const span = Math.abs((pos.get(e.to) ?? 0) - (pos.get(e.from) ?? 0));
        const reach = Math.min(lane + 4, 44 + 16 * span) * (back ? 1 : -1);
        const edgeX = back ? right(a) : a.x;
        const sy = cy(a) + (back ? -6 : 6);
        const ey = cy(b) + (back ? 6 : -6);
        out.push(edgePath(e, index, { d: `M ${round(edgeX)},${round(sy)} C ${round(edgeX + reach)},${round(sy)} ${round(edgeX + reach)},${round(ey)} ${round(edgeX)},${round(ey)}`, arrow: arrow(edgeX, ey, back ? -1 : 1, 0), route: 'arc', labelX: back ? edgeX + laneR / 2 + 4 : edgeX - laneL / 2 - 4, labelY: (sy + ey) / 2, labelAlign: 'center', labelChars: Math.floor((lane - 8) / LABEL_CHAR_W) }));
      }
    });
  } else {
    // Rows that snake: left to right, then right to left, so each row hands over with a short drop.
    const rows = Math.ceil(n / perRow);
    const cols = Math.min(perRow, n);
    const sidePad = rows > 1 ? 30 : 16;
    const nodeW = Math.min(176, (opt.width - sidePad * 2 - (cols - 1) * gapX) / cols);
    const total = cols * nodeW + (cols - 1) * gapX;
    width = Math.max(opt.width, total + sidePad * 2);
    const x0 = (width - total) / 2;
    const sizing = sizeNodes(v.nodes, nodeW);
    const above = hasForward ? ARC_SPACE : hasChainLabel ? LABEL_SPACE : 0;
    const below = hasBack || hasLoop ? ARC_SPACE : 0;
    const rowGap = Math.max(40, 16 + above + below);
    const rowOf = (i: number) => Math.floor(i / perRow);
    // The outer margins only reserve arc room when the first or last row actually has something arcing out of it.
    const rowsOf = (i: number) => { const a = rowOf(pos.get(edges[i].edge.from) ?? 0); const b = rowOf(pos.get(edges[i].edge.to) ?? 0); return a === b ? a : -1; };
    const firstRowArc = classes.some((c, i) => c === 'forward' && rowsOf(i) === 0);
    const firstRowLabel = edges.some(({ edge }, i) => classes[i] === 'chain' && isLabelled(edge) && rowsOf(i) === 0);
    const lastRowArc = classes.some((c, i) => (c === 'back' || c === 'loop') && rowsOf(i) === rows - 1);
    const top = 16 + (firstRowArc ? ARC_SPACE : firstRowLabel ? LABEL_SPACE : 0);
    const colOf = (i: number) => (rowOf(i) % 2 === 0 ? i % perRow : cols - 1 - (i % perRow));
    order.forEach((id, i) => boxes.set(id, place(byId.get(id)!, sizing, x0 + colOf(i) * (nodeW + gapX), top + rowOf(i) * (sizing.height + rowGap), nodeW)));
    height = top + rows * sizing.height + (rows - 1) * rowGap + 16 + (lastRowArc ? ARC_SPACE : 0);
    const quarter = nodeW / 4;

    edges.forEach(({ edge: e, index }, i) => {
      const a = boxes.get(e.from)!;
      const b = boxes.get(e.to)!;
      const kind = classes[i];
      const ia = pos.get(e.from) ?? 0;
      const ib = pos.get(e.to) ?? 0;
      const sameRow = rowOf(ia) === rowOf(ib);
      if (kind === 'loop') out.push(edgePath(e, index, loopGeometry(a, 'bottom', 0)));
      else if (kind === 'chain' && sameRow) {
        const dir = b.x > a.x ? 1 : -1;
        const sx = dir > 0 ? right(a) : a.x;
        const ex = dir > 0 ? b.x : right(b);
        out.push(edgePath(e, index, { d: `M ${round(sx)},${round(cy(a))} L ${round(ex)},${round(cy(b))}`, arrow: arrow(ex, cy(b), dir, 0), route: 'chain', labelX: (sx + ex) / 2, labelY: a.y - 8, labelAlign: 'above', labelChars: clamp(Math.floor((nodeW + gapX - 16) / LABEL_CHAR_W), 10, 26) }));
      } else if (kind === 'chain') {
        out.push(edgePath(e, index, { d: `M ${round(cx(a))},${round(bottom(a))} L ${round(cx(b))},${round(b.y)}`, arrow: arrow(cx(b), b.y, 0, 1), route: 'chain', labelX: cx(a), labelY: (bottom(a) + b.y) / 2, labelAlign: 'center', labelChars: clamp(Math.floor(nodeW / LABEL_CHAR_W), 10, 26) }));
      } else if (sameRow) {
        // Returns arc under the row, skips over it.
        const back = kind === 'back';
        const depth = Math.min(56, 26 + 10 * Math.abs(colOf(ia) - colOf(ib))) * (back ? 1 : -1);
        const sy = back ? bottom(a) : a.y;
        const ey = back ? bottom(b) : b.y;
        out.push(edgePath(e, index, { d: `M ${round(cx(a))},${round(sy)} C ${round(cx(a))},${round(sy + depth)} ${round(cx(b))},${round(ey + depth)} ${round(cx(b))},${round(ey)}`, arrow: arrow(cx(b), ey, 0, back ? -1 : 1), route: 'arc', labelX: (cx(a) + cx(b)) / 2, labelY: back ? sy + depth * 0.75 + 15 : sy + depth * 0.75 - 7, labelAlign: back ? 'below' : 'above', labelChars: clamp(Math.floor(Math.abs(cx(a) - cx(b)) / LABEL_CHAR_W), 10, 26) }));
      } else {
        // Different rows: travel through the gaps between rows, and down a side lane when rows lie between.
        const up = kind === 'back';
        const shift = up ? quarter : -quarter;
        const adjacent = Math.abs(rowOf(ia) - rowOf(ib)) === 1;
        const leave = up ? a.y : bottom(a);
        const enter = up ? bottom(b) : b.y;
        const yA = leave + (up ? -14 : 14);
        const yB = enter + (up ? 14 : -14);
        const laneX = up ? x0 + total + 16 : x0 - 16;
        const points: [number, number][] = adjacent
          ? [[cx(a) + shift, leave], [cx(a) + shift, yA], [cx(b) + shift, yA], [cx(b) + shift, enter]]
          : [[cx(a) + shift, leave], [cx(a) + shift, yA], [laneX, yA], [laneX, yB], [cx(b) + shift, yB], [cx(b) + shift, enter]];
        out.push(edgePath(e, index, { d: roundedPath(points), arrow: arrow(cx(b) + shift, enter, 0, up ? -1 : 1), route: 'arc', labelX: (points[1][0] + points[2][0]) / 2, labelY: yA, labelAlign: 'center', labelChars: 16 }));
      }
    });
  }

  return { diagramType: v.diagramType, orientation: perRow < 2 ? 'vertical' : 'horizontal', width: round(width), height: round(height), nodes: order.map((id) => boxes.get(id)!), edges: out, kindLine: v.nodes.some((node) => node.kind !== 'process'), axis: null, zones: null };
}

/**
 * Longest-path layering. Edges that would close a cycle, and return edges, are
 * left out of the ranking (and drawn afterwards), so a cyclic graph still terminates.
 */
export function layerNodes(nodes: DiagramNode[], edges: DiagramEdge[]): number[] {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const out: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b && !isReturn(e)) out[a].push(b);
  }
  const state = nodes.map(() => 0);
  const kept: number[][] = nodes.map(() => []);
  const indegree = nodes.map(() => 0);
  const visit = (a: number) => {
    state[a] = 1;
    for (const b of out[a]) {
      if (state[b] === 1) continue; // closes a cycle
      kept[a].push(b);
      indegree[b] += 1;
      if (state[b] === 0) visit(b);
    }
    state[a] = 2;
  };
  nodes.forEach((_, i) => { if (state[i] === 0) visit(i); });

  const layer = nodes.map(() => 0);
  const queue = nodes.map((_, i) => i).filter((i) => indegree[i] === 0);
  for (let head = 0; head < queue.length; head++) {
    const a = queue[head];
    for (const b of kept[a]) {
      layer[b] = Math.max(layer[b], layer[a] + 1);
      indegree[b] -= 1;
      if (indegree[b] === 0) queue.push(b);
    }
  }
  return layer;
}

function layoutNetwork(v: Visualization, opt: LayoutOptions): DiagramLayout {
  const edges = knownEdges(v);
  const layer = layerNodes(v.nodes, edges.map((e) => e.edge));
  const layerOf = new Map(v.nodes.map((n, i) => [n.id, layer[i]]));
  const count = Math.max(...layer) + 1;
  const groups: DiagramNode[][] = Array.from({ length: count }, () => []);
  v.nodes.forEach((n, i) => groups[layer[i]].push(n));
  const tallest = Math.max(...groups.map((g) => g.length));
  const hasLoop = edges.some(({ edge }) => edge.from === edge.to);
  // Edges between neighbouring layers are short links. Anything longer, or going back, travels round the outside
  // in a lane of its own so it never runs through the nodes in between.
  const reach = (e: DiagramEdge) => (layerOf.get(e.to) ?? 0) - (layerOf.get(e.from) ?? 0);
  const isLong = (e: DiagramEdge) => e.from !== e.to && Math.abs(reach(e)) !== 1;
  const backLane = edges.some(({ edge }) => isLong(edge) && reach(edge) <= 0);
  const forwardLane = edges.some(({ edge }) => isLong(edge) && reach(edge) > 0);
  const boxes = new Map<string, NodeBox>();
  let width: number;
  let height: number;
  let kindLine: boolean;

  if (opt.orientation === 'horizontal') {
    // Layers are columns, read left to right. Long forward edges arc over the top, returns under the bottom.
    const pad = 16;
    const laneT = forwardLane ? 44 : 0;
    const laneB = backLane ? 44 : 0;
    const gapX = 56;
    const gapY = 18;
    const nodeW = clamp((opt.width - pad * 2 - (count - 1) * gapX) / count, 124, 176);
    const total = count * nodeW + (count - 1) * gapX;
    width = Math.max(opt.width, total + pad * 2);
    const x0 = (width - total) / 2;
    const sizing = sizeNodes(v.nodes, nodeW);
    kindLine = sizing.kindLine;
    const columnHeight = (k: number) => k * sizing.height + (k - 1) * gapY;
    const inner = columnHeight(tallest);
    groups.forEach((group, l) => group.forEach((node, j) => boxes.set(node.id, place(node, sizing, x0 + l * (nodeW + gapX), pad + laneT + (inner - columnHeight(group.length)) / 2 + j * (sizing.height + gapY), nodeW))));
    height = inner + pad * 2 + laneT + laneB + (hasLoop ? LOOP_SPACE : 0);
  } else {
    // Layers are bands, read top to bottom. A crowded layer wraps onto extra rows instead of shrinking its boxes.
    // Returns travel down a lane on the right, long forward edges down one on the left.
    const pad = 14;
    const gapX = 14;
    const laneR = backLane ? 64 : 0;
    const laneL = forwardLane ? 64 : 0;
    const room = opt.width - laneL - laneR;
    const perRow = Math.max(1, Math.floor((room - pad * 2 + gapX) / (124 + gapX)));
    const k = Math.min(perRow, tallest);
    const nodeW = clamp((room - pad * 2 - (k - 1) * gapX) / k, 124, 240);
    width = Math.max(opt.width, k * nodeW + (k - 1) * gapX + pad * 2 + laneL + laneR);
    const centre = laneL + (width - laneL - laneR) / 2;
    const sizing = sizeNodes(v.nodes, nodeW);
    kindLine = sizing.kindLine;
    let y = pad;
    groups.forEach((group, l) => {
      if (l > 0) y += 52;
      for (let start = 0; start < group.length; start += perRow) {
        if (start > 0) y += 14;
        const row = group.slice(start, start + perRow);
        const rowW = row.length * nodeW + (row.length - 1) * gapX;
        row.forEach((node, j) => boxes.set(node.id, place(node, sizing, centre - rowW / 2 + j * (nodeW + gapX), y, nodeW)));
        y += sizing.height;
      }
    });
    height = y + pad + (hasLoop ? LOOP_SPACE : 0);
  }

  const out = edges.map(({ edge: e, index }) => {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    if (e.from === e.to) return edgePath(e, index, loopGeometry(a, 'bottom', 0));
    if (isLong(e)) {
      const back = reach(e) <= 0;
      if (opt.orientation === 'vertical') {
        const laneX = back ? width - 6 : 6;
        const sx = back ? right(a) : a.x;
        const ex = back ? right(b) : b.x;
        return edgePath(e, index, { d: `M ${round(sx)},${round(cy(a))} C ${round(laneX)},${round(cy(a))} ${round(laneX)},${round(cy(b))} ${round(ex)},${round(cy(b))}`, arrow: arrow(ex, cy(b), back ? -1 : 1, 0), route: 'arc', labelX: back ? width - 34 : 34, labelY: (cy(a) + cy(b)) / 2, labelAlign: 'center', labelChars: 8 });
      }
      const laneY = back ? height - 6 : 6;
      const sy = back ? bottom(a) : a.y;
      const ey = back ? bottom(b) : b.y;
      return edgePath(e, index, { d: `M ${round(cx(a))},${round(sy)} C ${round(cx(a))},${round(laneY)} ${round(cx(b))},${round(laneY)} ${round(cx(b))},${round(ey)}`, arrow: arrow(cx(b), ey, 0, back ? -1 : 1), route: 'arc', labelX: (cx(a) + cx(b)) / 2, labelY: back ? height - 16 : 14, labelAlign: 'center', labelChars: 16 });
    }
    // A return between neighbouring layers runs beside the forward edge instead of on top of it.
    return edgePath(e, index, linkGeometry(a, b, opt.orientation, isReturn(e) || reach(e) < 0 ? 10 : 0));
  });
  return { diagramType: v.diagramType, orientation: opt.orientation, width: round(width), height: round(height), nodes: v.nodes.map((n) => boxes.get(n.id)!), edges: out, kindLine, axis: null, zones: null };
}

function layoutTimeline(v: Visualization, opt: LayoutOptions): DiagramLayout {
  const n = v.nodes.length;
  if (opt.orientation === 'horizontal') {
    // Entries alternate above and below the line, so each can be two intervals wide.
    const pitch = clamp((opt.width + 4) / (n + 1), 66, 200);
    const boxW = Math.min(170, pitch * 2 - 12);
    const side = Math.max(16, boxW / 2 - pitch / 2 + 4);
    const needed = side * 2 + n * pitch;
    const width = Math.max(opt.width, needed);
    const x0 = (width - needed) / 2 + side;
    const sizing = sizeNodes(v.nodes, boxW);
    const axisY = 16 + sizing.height + 18;
    const nodes = v.nodes.map((node, i) => {
      const x = x0 + pitch * (i + 0.5);
      return { ...place(node, sizing, x - boxW / 2, i % 2 === 0 ? 16 : axisY + 18, boxW), dot: { x: round(x), y: axisY } };
    });
    return { diagramType: v.diagramType, orientation: 'horizontal', width: round(width), height: axisY + 18 + sizing.height + 16, nodes, edges: [], kindLine: sizing.kindLine, axis: { x1: round(x0), y1: axisY, x2: round(x0 + pitch * n), y2: axisY }, zones: null };
  }
  const boxW = clamp(opt.width - 44 - 12, 124, 360);
  const width = Math.max(opt.width, boxW + 56);
  const sizing = sizeNodes(v.nodes, boxW);
  const gap = 14;
  const nodes = v.nodes.map((node, i) => {
    const y = 16 + i * (sizing.height + gap);
    return { ...place(node, sizing, 44, y, boxW), dot: { x: 22, y: round(y + sizing.height / 2) } };
  });
  const height = 32 + n * sizing.height + (n - 1) * gap;
  return { diagramType: v.diagramType, orientation: 'vertical', width: round(width), height: round(height), nodes, edges: [], kindLine: sizing.kindLine, axis: { x1: 22, y1: 16, x2: 22, y2: round(height - 16) }, zones: null };
}

/** Where the highlighted region sits inside the output frame, as fractions of the frame. The renderer draws a shape under it. */
export const IMAGE_REGION = { x: 0.56, y: 0.3, width: 0.36, height: 0.52 } as const;

function layoutImageAnalysis(v: Visualization, opt: LayoutOptions): DiagramLayout {
  const edges = knownEdges(v);
  const inputs = v.nodes.filter((n) => n.kind === 'input');
  // The output frame is followed by what was found and then by the people who review it.
  const outputs = [...v.nodes.filter((n) => n.kind === 'output'), ...v.nodes.filter((n) => n.kind === 'human')];
  const middle = v.nodes.filter((n) => n.kind !== 'input' && n.kind !== 'output' && n.kind !== 'human');
  const hasLoop = edges.some(({ edge }) => edge.from === edge.to);
  // Stacked boxes need room between them for a caption when an edge carries one.
  const gap = edges.some(({ edge }) => isLabelled(edge)) ? 30 : 12;
  const boxes = new Map<string, NodeBox>();
  let width: number;
  let height: number;
  let input: Rect;
  let output: Rect;
  let sizing: Sizing;

  if (opt.orientation === 'horizontal') {
    const pad = 16;
    const gapX = 52;
    const colW = clamp((opt.width - pad * 2 - gapX * 2) / 3, 150, 230);
    const total = colW * 3 + gapX * 2;
    width = Math.max(opt.width, total + pad * 2);
    const x0 = (width - total) / 2;
    const frameH = Math.round(colW * 0.72);
    sizing = sizeNodes(v.nodes, colW);
    const stack = (k: number) => (k ? k * sizing.height + (k - 1) * gap : 0);
    const framed = (k: number) => frameH + (k ? gap + stack(k) : 0);
    const inner = Math.max(framed(inputs.length), stack(middle.length), framed(outputs.length));
    input = { x: round(x0), y: pad, width: round(colW), height: frameH };
    output = { x: round(x0 + (colW + gapX) * 2), y: pad, width: round(colW), height: frameH };
    inputs.forEach((node, j) => boxes.set(node.id, place(node, sizing, input.x, pad + frameH + gap + j * (sizing.height + gap), colW)));
    middle.forEach((node, j) => boxes.set(node.id, place(node, sizing, x0 + colW + gapX, pad + (inner - stack(middle.length)) / 2 + j * (sizing.height + gap), colW)));
    outputs.forEach((node, j) => boxes.set(node.id, place(node, sizing, output.x, pad + frameH + gap + j * (sizing.height + gap), colW)));
    height = inner + pad * 2 + (hasLoop ? LOOP_SPACE : 0);
  } else {
    const pad = 14;
    const band = 30;
    const nodeW = clamp(opt.width - pad * 2, 124, 320);
    width = Math.max(opt.width, nodeW + pad * 2);
    const frameW = Math.min(nodeW, 260);
    const frameH = Math.round(frameW * 0.6);
    const x = (width - nodeW) / 2;
    sizing = sizeNodes(v.nodes, nodeW);
    let y = pad;
    const stackFrom = (group: DiagramNode[]) => {
      group.forEach((node) => { boxes.set(node.id, place(node, sizing, x, y, nodeW)); y += sizing.height + gap; });
    };
    input = { x: round((width - frameW) / 2), y, width: frameW, height: frameH };
    y += frameH + gap;
    stackFrom(inputs);
    y += band - gap;
    stackFrom(middle);
    if (middle.length) y += band - gap;
    output = { x: round((width - frameW) / 2), y, width: frameW, height: frameH };
    y += frameH + gap;
    stackFrom(outputs);
    height = y - gap + pad + (hasLoop ? LOOP_SPACE : 0);
  }

  const region: Rect = { x: round(output.x + output.width * IMAGE_REGION.x), y: round(output.y + output.height * IMAGE_REGION.y), width: round(output.width * IMAGE_REGION.width), height: round(output.height * IMAGE_REGION.height) };
  const out = edges.map(({ edge: e, index }) => {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    if (e.from === e.to) return edgePath(e, index, loopGeometry(a, 'bottom', 0));
    return edgePath(e, index, linkGeometry(a, b, opt.orientation, isReturn(e) ? 10 : 0));
  });
  return { diagramType: v.diagramType, orientation: opt.orientation, width: round(width), height: round(height), nodes: [...inputs, ...middle, ...outputs].map((n) => boxes.get(n.id)!), edges: out, kindLine: sizing.kindLine, axis: null, zones: { input, output, region } };
}

/**
 * Positions every node and edge of a diagram for a container `width` CSS pixels
 * wide. The result may be wider than asked when the content cannot fit; callers
 * then either switch orientation (see `fitLayout`) or let the diagram scroll.
 * `comparison` and `chart` are drawn in HTML and get an empty layout.
 */
export function layoutDiagram(visualization: Visualization, options: LayoutOptions): DiagramLayout {
  const opt: LayoutOptions = { orientation: options.orientation === 'horizontal' ? 'horizontal' : 'vertical', width: Number.isFinite(options.width) ? clamp(Math.floor(options.width), 200, 1600) : DEFAULT_WIDTH };
  const empty: DiagramLayout = { diagramType: visualization.diagramType, orientation: opt.orientation, width: opt.width, height: 0, nodes: [], edges: [], kindLine: false, axis: null, zones: null };
  if (visualization.nodes.length === 0) return empty;
  switch (visualization.diagramType) {
    case 'flow':
    case 'process': return layoutChain(visualization, opt);
    case 'network': return layoutNetwork(visualization, opt);
    case 'timeline': return layoutTimeline(visualization, opt);
    case 'image-analysis': return layoutImageAnalysis(visualization, opt);
    default: return empty;
  }
}

/** Horizontal when the container is wide enough for it, otherwise vertical: text keeps its size and the diagram grows downwards. */
export function fitLayout(visualization: Visualization, width: number): DiagramLayout {
  if (width >= HORIZONTAL_MIN_WIDTH) {
    const horizontal = layoutDiagram(visualization, { orientation: 'horizontal', width });
    if (horizontal.width <= width + 0.5) return horizontal;
  }
  return layoutDiagram(visualization, { orientation: 'vertical', width });
}
