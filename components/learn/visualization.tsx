'use client';

/*
 * The visualization engine. Plain React, inline SVG and CSS: no Framer Motion,
 * D3, React Flow or Recharts. The same components ship inside a single page of
 * about 110 KB that runs on React 18 from a CDN, so a diagram library would cost
 * more bytes than the whole product, and fourteen nodes need no physics engine.
 * Geometry lives in lib/explain/layout.ts; motion is CSS on transform, opacity
 * and stroke-dashoffset only (see the Learn block in app/globals.css).
 *
 * Data is untrusted. It is validated again here, a renderer is picked from the
 * fixed registry below, and every string reaches the page as a React text node.
 */
import { CircleCheck, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { createElement, useId, useMemo, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { DEFAULT_WIDTH, fitLayout, KIND_HEIGHT, LINE_HEIGHT, textUnits, wrapLabel, type DiagramLayout, type EdgePath, type NodeBox, type Rect } from '@/lib/explain/layout';
import { LIMITS, parseVisualization, type DiagramType, type ExplanationStep, type Visualization } from '@/lib/explain/model';
import type { T } from '@/lib/i18n';
import { useElementWidth } from './hooks';

export type HeadingLevel = 2 | 3 | 4 | 5;

export interface VisualizationViewProps {
  visualization: Visualization;
  /** Zero-based. Omit to let the component keep its own position. */
  stepIndex?: number;
  onStepChange?: (index: number) => void;
  t: T;
  /** Forces the static presentation. The system setting is honoured either way. */
  reducedMotion?: boolean;
  /** Tighter spacing and no step list, for use inside Story Mode. */
  compact?: boolean;
  /** Left and Right move between steps while focus is inside. Story Mode turns this off and uses the keys for scenes. */
  arrowKeys?: boolean;
  /** Level of the diagram title; the step title is one below. */
  headingLevel?: HeadingLevel;
}

export interface RendererProps {
  visualization: Visualization;
  step: ExplanationStep;
  stepIndex: number;
  /** Node ids in focus at this step. Empty means nothing is singled out. */
  active: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  t: T;
  /** Measured container width, or null before the first measurement. */
  width: number | null;
  ids: { title: string; alt: string; caption: string };
  headingLevel: HeadingLevel;
}

type NodeState = 'active' | 'dim' | 'neutral';

function Heading({ level, children, ...rest }: { level: number; id?: string; className?: string; children: ReactNode }) {
  return createElement(`h${Math.min(6, Math.max(2, level))}`, rest, children);
}

function NodeButton({ box, state, selected, onSelect, t, captionId, showKinds }: { box: NodeBox; state: NodeState; selected: boolean; onSelect: (id: string) => void; t: T; captionId: string; showKinds: boolean }) {
  const showKind = showKinds && box.kind !== 'process';
  const kindName = t(`learn.kind.${box.kind}`);
  const middle = box.x + box.width / 2;
  const top = box.y + (box.height - (showKind ? KIND_HEIGHT : 0) - box.lines.length * LINE_HEIGHT) / 2;
  // Colour is never the only signal: an active node also has a heavier outline and says so in its name.
  const name = [box.label, showKind ? kindName : null, state === 'active' ? t('learn.active') : null].filter(Boolean).join(', ');
  const select = () => onSelect(box.id);
  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    select();
  };
  return (
    <g className="viz-node" role="button" tabIndex={0} aria-label={name} aria-controls={captionId} data-state={state} data-selected={selected} onClick={select} onFocus={select} onKeyDown={onKeyDown}>
      <rect className="viz-node-box" x={box.x} y={box.y} width={box.width} height={box.height} rx={10} />
      <rect className="viz-node-ring" x={box.x + 1.25} y={box.y + 1.25} width={box.width - 2.5} height={box.height - 2.5} rx={9} />
      <rect className="viz-node-focus" x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6} rx={13} />
      {showKind ? <text className="viz-node-kind" x={middle} y={top + 12} textAnchor="middle">{kindName}</text> : null}
      <text className="viz-node-label" x={middle} y={top + (showKind ? KIND_HEIGHT : 0) + 13} textAnchor="middle">
        {box.lines.map((line, i) => <tspan key={i} x={middle} dy={i === 0 ? 0 : LINE_HEIGHT}>{line}</tspan>)}
      </text>
    </g>
  );
}

const edgeText = (edge: EdgePath, t: T): string | null => edge.label ?? (edge.kind === 'data' ? null : t(`learn.edge.${edge.kind}`));

function EdgeLabel({ edge, text }: { edge: EdgePath; text: string }) {
  const lines = wrapLabel(text, edge.labelChars, 2);
  const lineHeight = 14;
  const extra = (lines.length - 1) * lineHeight;
  const first = edge.labelAlign === 'above' ? edge.labelY - extra : edge.labelAlign === 'below' ? edge.labelY : edge.labelY - extra / 2 + 4;
  // A plate behind the words, sized from the same character estimate the layout wraps with, so a line never runs through them.
  const plate = Math.max(...lines.map(textUnits)) * 7 + 10;
  return (
    <>
      <rect className="viz-edge-plate" x={edge.labelX - plate / 2} y={first - 12} width={plate} height={extra + 17} rx={4} />
      <text className="viz-edge-label" x={edge.labelX} y={first} textAnchor="middle">
        {lines.map((line, i) => <tspan key={i} x={edge.labelX} dy={i === 0 ? 0 : lineHeight}>{line}</tspan>)}
      </text>
    </>
  );
}

/**
 * A deliberately abstract picture: three plain shapes on a flat ground, labelled
 * as simulated. It stands for "an image goes in" and must never resemble a real scan.
 */
function SimulatedImage({ frame, tag, region, regionShown, regionLabel }: { frame: Rect; tag: string; region?: Rect; regionShown?: boolean; regionLabel?: string }) {
  const { x, y, width: w, height: h } = frame;
  return (
    <g className="viz-img">
      <rect className="viz-img-under" x={x} y={y} width={w} height={h} rx={8} />
      <rect className="viz-img-frame" x={x} y={y} width={w} height={h} rx={8} />
      <rect className="viz-img-shape" x={x + w * 0.1} y={y + h * 0.5} width={w * 0.24} height={h * 0.32} rx={3} />
      <polygon className="viz-img-shape" points={`${x + w * 0.42},${y + h * 0.26} ${x + w * 0.54},${y + h * 0.48} ${x + w * 0.3},${y + h * 0.48}`} />
      <circle className="viz-img-shape" cx={x + w * 0.74} cy={y + h * 0.56} r={w * 0.12} />
      <text className="viz-img-tag" x={x + 8} y={y + 17}>{tag}</text>
      {region ? (
        <g className="viz-img-region" data-shown={Boolean(regionShown)} aria-hidden={!regionShown}>
          <rect x={region.x} y={region.y} width={region.width} height={region.height} rx={4} />
          <text x={x + w - 7} y={Math.min(y + h - 6, region.y + region.height + 14)} textAnchor="end">{regionLabel}</text>
        </g>
      ) : null}
    </g>
  );
}

/** Every node-and-edge diagram: flow, process, network, timeline and image analysis differ only in their layout. */
function DiagramSvg({ visualization, step, stepIndex, active, selected, onSelect, t, width, ids }: RendererProps) {
  const layout: DiagramLayout = useMemo(() => fitLayout(visualization, width ?? DEFAULT_WIDTH), [visualization, width]);
  const scrollable = width !== null && layout.width > width + 0.5;
  const stateOf = (id: string): NodeState => (active.size === 0 ? 'neutral' : active.has(id) ? 'active' : 'dim');
  const edgeActive = (e: EdgePath) => active.has(e.from) && active.has(e.to);
  // The result appears on the output frame once a step reaches an output (or at the last step when no node is marked as one).
  const outputIds = visualization.nodes.filter((n) => n.kind === 'output').map((n) => n.id);
  const regionShown = outputIds.length ? step.focus.some((id) => outputIds.includes(id)) : stepIndex === visualization.steps.length - 1;
  const region = scrollable ? { role: 'region', tabIndex: 0, 'aria-label': t('learn.scrollRegion', { title: visualization.title }) } : {};

  return (
    <div className="viz-scroll" data-scrollable={scrollable} {...region}>
      <svg className="viz-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="group" aria-labelledby={ids.title} aria-describedby={ids.alt} focusable="false" data-orientation={layout.orientation}>
        {layout.axis ? <line className="viz-axis" x1={layout.axis.x1} y1={layout.axis.y1} x2={layout.axis.x2} y2={layout.axis.y2} /> : null}
        {layout.edges.map((e) => (
          <g key={e.key} className="viz-edge" data-kind={e.kind} data-route={e.route} data-active={edgeActive(e)}>
            <path className="viz-edge-line" d={e.d} />
            {e.kind === 'data' && edgeActive(e) ? <path className="viz-edge-flow" d={e.d} /> : null}
            <polygon className="viz-edge-arrow" points={e.arrow} />
          </g>
        ))}
        {layout.zones ? (
          <>
            <SimulatedImage frame={layout.zones.input} tag={t('learn.image.input')} />
            <SimulatedImage frame={layout.zones.output} tag={t('learn.image.output')} region={layout.zones.region} regionShown={regionShown} regionLabel={t('learn.image.region')} />
          </>
        ) : null}
        {layout.nodes.map((box) => (box.dot ? (
          <g key={`dot-${box.id}`} className="viz-dot" data-state={stateOf(box.id)}>
            <line x1={box.dot.x} y1={box.dot.y} x2={layout.orientation === 'vertical' ? box.x : box.dot.x} y2={layout.orientation === 'vertical' ? box.dot.y : box.dot.y < box.y ? box.y : box.y + box.height} />
            <circle cx={box.dot.x} cy={box.dot.y} r={stateOf(box.id) === 'active' ? 7 : 5} />
          </g>
        ) : null))}
        {layout.nodes.map((box) => <NodeButton key={box.id} box={box} state={stateOf(box.id)} selected={selected === box.id} onSelect={onSelect} t={t} captionId={ids.caption} showKinds={layout.kindLine} />)}
        {layout.edges.map((e) => {
          const text = edgeText(e, t);
          return text ? <g key={`label-${e.key}`} className="viz-edge" data-kind={e.kind} data-active={edgeActive(e)}><EdgeLabel edge={e} text={text} /></g> : null;
        })}
      </svg>
    </div>
  );
}

function ImageAnalysis(props: RendererProps) {
  return (
    <>
      <DiagramSvg {...props} />
      <p className="viz-img-caption t-meta">{props.t('learn.image.caption')}</p>
    </>
  );
}

/** Side-by-side cards that stack when the container is narrow. HTML, so the text wraps and reflows by itself. */
function Comparison({ visualization, headingLevel }: RendererProps) {
  return (
    <div className="viz-columns">
      {visualization.columns.map((column, i) => (
        <section key={i} className="viz-column">
          <Heading level={headingLevel + 1} className="t-card break-anywhere">{column.title}</Heading>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 t-small marker:text-fg3">
            {column.points.map((point, j) => <li key={j} className="break-anywhere">{point}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

const formatValue = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Horizontal bars measured from zero, each with its value printed. Values in different units never share a scale. */
function Chart({ visualization, t }: RendererProps) {
  const groups: { unit: string; rows: Visualization['series'] }[] = [];
  for (const s of visualization.series) {
    const unit = s.unit ?? '';
    const group = groups.find((g) => g.unit === unit);
    if (group) group.rows.push(s);
    else groups.push({ unit, rows: [s] });
  }
  return (
    <div className="viz-chart">
      {groups.map((group) => {
        const low = Math.min(0, ...group.rows.map((r) => r.value));
        const high = Math.max(0, ...group.rows.map((r) => r.value));
        const span = high - low || 1;
        const zero = ((0 - low) / span) * 100;
        return (
          <div key={group.unit}>
            {groups.length > 1 ? <p className="t-meta mb-2">{group.unit ? t('learn.chart.unit', { unit: group.unit }) : t('learn.chart.noUnit')}</p> : null}
            <ul className="flex flex-col gap-3">
              {group.rows.map((row, i) => {
                const at = ((row.value - low) / span) * 100;
                return (
                  <li key={i} className="viz-bar-row">
                    <span className="t-small break-anywhere">{row.label}</span>
                    <span className="t-small t-num font-medium">{formatValue(row.value)}{row.unit ? ` ${row.unit}` : ''}</span>
                    <span className="viz-bar-track" aria-hidden="true">
                      <span className="viz-bar" style={{ left: `${Math.min(zero, at)}%`, width: `${Math.abs(at - zero)}%` }} />
                      {low < 0 ? <span className="viz-bar-zero" style={{ left: `${zero}%` }} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="t-meta">{t('learn.chart.zero')}</p>
    </div>
  );
}

/**
 * The only way a diagram type reaches the page. Data picks a key, never a
 * component, and a key that is not listed here gets the text alternative.
 */
export const RENDERERS: Record<DiagramType, ComponentType<RendererProps>> = {
  flow: DiagramSvg,
  process: DiagramSvg,
  network: DiagramSvg,
  timeline: DiagramSvg,
  comparison: Comparison,
  chart: Chart,
  'image-analysis': ImageAnalysis,
};
export const SUPPORTED_DIAGRAM_TYPES = Object.keys(RENDERERS) as DiagramType[];

const plainText = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Shown when the data does not pass validation: whatever text it carries, as text, and nothing drawn from it. */
function TextFallback({ raw, t, headingLevel }: { raw: unknown; t: T; headingLevel: HeadingLevel }) {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const title = plainText(record.title, 100);
  const alternative = plainText(record.textAlternative, 1200);
  const steps = (Array.isArray(record.steps) ? record.steps.slice(0, LIMITS.steps) : [])
    .map((s: unknown) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ title: plainText(s.title, 80), description: plainText(s.description, LIMITS.detail) }))
    .filter((s) => s.title || s.description);
  return (
    <section className="viz" data-fallback="true">
      {title ? <Heading level={headingLevel} className="t-card break-anywhere">{title}</Heading> : null}
      <p className="learn-note" role="note"><Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{t('learn.diagramUnavailable')}</span></p>
      <p className="t-small measure break-anywhere">{alternative ?? t('learn.noTextAlternative')}</p>
      {steps.length ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5 t-small measure">
          {steps.map((s, i) => <li key={i} className="break-anywhere">{s.title ? <span className="font-medium">{s.title}</span> : null}{s.title && s.description ? ': ' : null}{s.description}</li>)}
        </ol>
      ) : null}
    </section>
  );
}

function Diagram({ visualization: v, stepIndex, onStepChange, t, reducedMotion, compact = false, arrowKeys = true, headingLevel }: Omit<VisualizationViewProps, 'headingLevel'> & { headingLevel: HeadingLevel }) {
  const uid = useId();
  const ids = { title: `${uid}-title`, alt: `${uid}-alt`, caption: `${uid}-caption` };
  const [frameRef, width] = useElementWidth<HTMLDivElement>();
  const [ownIndex, setOwnIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const total = v.steps.length;
  const controlled = typeof stepIndex === 'number' && Number.isFinite(stepIndex);
  const index = Math.min(total - 1, Math.max(0, Math.floor(controlled ? stepIndex : ownIndex)));
  const step = v.steps[index];
  const active = useMemo(() => new Set(step.focus), [step]);
  const Renderer = RENDERERS[v.diagramType];
  const hasNodes = v.diagramType !== 'comparison' && v.diagramType !== 'chart';
  const selectedNode = hasNodes ? v.nodes.find((n) => n.id === selected) : undefined;

  const go = (next: number) => {
    const to = Math.min(total - 1, Math.max(0, next));
    if (to === index) return;
    if (!controlled) setOwnIndex(to);
    onStepChange?.(to);
    // Spoken only for moves the reader made here; a host that drives the step announces its own changes.
    setAnnouncement(`${t('learn.step', { n: to + 1, total })}: ${v.steps[to].title}`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!arrowKeys || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // A diagram that scrolls keeps the arrow keys for scrolling while it has focus.
    if ((e.target as HTMLElement).dataset?.scrollable === 'true') return;
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else return;
    e.preventDefault();
  };

  return (
    <section className="viz" aria-labelledby={ids.title} data-compact={compact} data-reduced-motion={reducedMotion ? 'true' : undefined} data-diagram={v.diagramType} onKeyDown={onKeyDown}>
      <Heading level={headingLevel} id={ids.title} className="t-card break-anywhere">{v.title}</Heading>
      <p className="viz-badge" data-confirmed={v.confirmed}>
        {v.confirmed ? <CircleCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
        <span>{t(v.confirmed ? 'learn.confirmed' : 'learn.illustrative')}</span>
      </p>

      <figure className="viz-frame" role="group" aria-labelledby={ids.title} aria-describedby={ids.alt}>
        <div ref={frameRef}>
          <Renderer visualization={v} step={step} stepIndex={index} active={active} selected={selected} onSelect={setSelected} t={t} width={width} ids={ids} headingLevel={headingLevel} />
        </div>
      </figure>
      <p id={ids.alt} className="sr-only">{v.textAlternative}</p>

      {hasNodes ? (
        <div id={ids.caption} className="viz-caption t-small" aria-live="polite">
          {selectedNode ? (
            <p className="break-anywhere"><span className="font-medium text-fg">{selectedNode.label}</span> <span className="tag align-middle">{t(`learn.kind.${selectedNode.kind}`)}</span><br />{selectedNode.detail ?? t('learn.nodeNoDetail')}</p>
          ) : <p>{t('learn.nodeHint')}</p>}
        </div>
      ) : null}

      <div className="viz-step">
        <p className="flex flex-wrap items-center gap-2 t-meta t-num">
          <span>{t('learn.step', { n: index + 1, total })}</span>
          {step.illustrative ? <span className="tag">{t('learn.stepIllustrative')}</span> : null}
        </p>
        <Heading level={headingLevel + 1} className="t-card mt-1 break-anywhere">{step.title}</Heading>
        <p className="t-small mt-1 text-fg2 measure break-anywhere">{step.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus when the reader reaches either end. */}
          <button type="button" className="btn" aria-disabled={index === 0} aria-label={t('learn.previousStep')} onClick={() => go(index - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />{t('learn.previous')}
          </button>
          <button type="button" className="btn" aria-disabled={index === total - 1} aria-label={t('learn.nextStep')} onClick={() => go(index + 1)}>
            {t('learn.next')}<ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {compact ? null : (
          <ol className="viz-step-list" aria-label={t('learn.steps')}>
            {v.steps.map((s, i) => (
              <li key={s.id}>
                <button type="button" className="viz-step-btn" aria-current={i === index ? 'step' : undefined} onClick={() => go(i)}>
                  <span className="t-num">{i + 1}.</span> {s.title}{s.illustrative ? <span className="viz-step-mark"> ({t('learn.stepIllustrativeShort')})</span> : null}
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </div>

      <details className="viz-text">
        <summary>{t('learn.readAsText')}</summary>
        <p className="t-small mt-2 measure break-anywhere">{v.textAlternative}</p>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 t-small measure">
          {v.steps.map((s) => (
            <li key={s.id} className="break-anywhere">
              <span className="font-medium">{s.title}</span>{s.illustrative ? ` (${t('learn.stepIllustrativeShort')})` : ''}: {s.description}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

/**
 * One diagram with its step-by-step walkthrough. Anything that fails
 * `parseVisualization`, or names a diagram type with no renderer, is shown as
 * its text alternative instead; this component does not throw on bad data.
 */
export function VisualizationView({ visualization, headingLevel = 3, ...rest }: VisualizationViewProps) {
  const parsed = useMemo(() => parseVisualization(visualization), [visualization]);
  if (!parsed || !Object.prototype.hasOwnProperty.call(RENDERERS, parsed.diagramType)) return <TextFallback raw={visualization} t={rest.t} headingLevel={headingLevel} />;
  return <Diagram visualization={parsed} headingLevel={headingLevel} {...rest} />;
}
