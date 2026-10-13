'use client';

/*
 * The five ways of explaining one discovery. Inside each, what the sources say
 * and what is only general background sit in separate, differently built
 * blocks with their own headings, so a general explanation can never be read
 * as a claim about the specific project.
 */
import { BookOpen, CircleCheck, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { LAYER_IDS, LAYER_NAMES, parseExplanation, type Explanation, type LayerId } from '@/lib/explain/model';
import type { T } from '@/lib/i18n';
import { tr } from './hooks';

export interface LayerViewProps {
  explanation: Explanation;
  /** Omit to let the component keep its own selection. */
  layerId?: LayerId;
  onLayerChange?: (id: LayerId) => void;
  t: T;
}

function Layers({ explanation, layerId, onLayerChange, t }: LayerViewProps) {
  const uid = useId();
  const [ownId, setOwnId] = useState<LayerId>('simple');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current: LayerId = layerId && LAYER_IDS.includes(layerId) ? layerId : ownId;
  const layer = explanation.layers.find((l) => l.id === current);
  const evidence = layer?.evidence ?? [];
  const concept = layer?.concept ?? [];

  const choose = (id: LayerId) => {
    if (id === current) return;
    if (!layerId) setOwnId(id);
    onLayerChange?.(id);
  };
  // Selection follows focus: the panels are short and already on the page, so there is nothing to wait for.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = LAYER_IDS.indexOf(current);
    const last = LAYER_IDS.length - 1;
    const next = e.key === 'ArrowRight' ? (at === last ? 0 : at + 1) : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    tabs.current[next]?.focus();
    choose(LAYER_IDS[next]);
  };

  return (
    <div className="layers">
      <div role="tablist" aria-label={t('learn.layers')} className="layer-tabs scroll-x" onKeyDown={onKeyDown}>
        {LAYER_IDS.map((id, i) => (
          <button key={id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`${uid}-tab-${id}`} aria-selected={id === current} aria-controls={`${uid}-panel`} tabIndex={id === current ? 0 : -1} className="layer-tab" onClick={() => choose(id)}>
            {tr(t, `learn.layer.${id}`, LAYER_NAMES[id])}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${current}`} tabIndex={0} className="layer-panel">
        {evidence.length ? (
          <section className="layer-evidence" data-source="evidence">
            <h3 className="layer-heading"><CircleCheck size={16} className="shrink-0 text-good" aria-hidden="true" />{t('learn.layer.evidence')}</h3>
            <div className="t-body measure break-anywhere prose-note">{evidence.map((p, i) => <p key={i}>{p}</p>)}</div>
          </section>
        ) : null}
        {concept.length ? (
          <section className="layer-concept" data-source="concept">
            <h3 className="layer-heading"><BookOpen size={16} className="shrink-0 text-fg2" aria-hidden="true" />{t('learn.layer.concept')}</h3>
            <p className="t-meta mb-2">{t('learn.layer.conceptNote')}</p>
            <div className="t-body measure break-anywhere prose-note">{concept.map((p, i) => <p key={i}>{p}</p>)}</div>
          </section>
        ) : null}
        {evidence.length === 0 && concept.length === 0 ? <p className="t-body text-fg2 measure">{t('learn.layer.empty')}</p> : null}
        {layer?.caveat ? (
          <p className="learn-note" role="note" data-tone="warn">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
            <span className="break-anywhere"><span className="font-medium text-fg">{t('learn.layer.caveat')}:</span> {layer.caveat}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Tabbed explanation layers. Explanation data is validated again here; invalid data shows a note instead of tabs. */
export function LayerView({ explanation, ...rest }: LayerViewProps) {
  const parsed = useMemo(() => parseExplanation(explanation), [explanation]);
  if (!parsed) return <p className="learn-note" role="note">{rest.t('learn.unavailable')}</p>;
  return <Layers explanation={parsed} {...rest} />;
}
