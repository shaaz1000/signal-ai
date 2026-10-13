'use client';

/*
 * Story Mode: eight scenes read at the reader's pace. Nothing plays until Play
 * is pressed, the transcript is always one click away, and under reduced motion
 * there is no auto-advance at all, only Previous and Next.
 */
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { parseExplanation, SCENE_NAMES, type Explanation, type StoryScene } from '@/lib/explain/model';
import type { T } from '@/lib/i18n';
import { tr, usePrefersReducedMotion } from './hooks';
import { VisualizationView } from './visualization';

export interface StoryPlayerProps {
  explanation: Explanation;
  t: T;
  /** Zero-based scene to open on. */
  initialScene?: number;
  onSceneChange?: (index: number, scene: StoryScene) => void;
  /** Forces manual stepping. The system setting is honoured either way. */
  reducedMotion?: boolean;
}

export const STORY_SPEEDS = [0.75, 1, 1.5, 2] as const;
export type StorySpeed = (typeof STORY_SPEEDS)[number];

// A comfortable reading pace for on-screen text, slower than silent reading of a page.
const WORDS_PER_MINUTE = 180;

/** How long a scene stays up at 1x: time to read its two texts, plus time to look at a diagram when there is one. */
export function sceneDwellMs(scene: Pick<StoryScene, 'narration' | 'onScreen' | 'stepId'>, speed = 1): number {
  const text = `${scene.onScreen} ${scene.narration}`.trim();
  // Scripts written without spaces are counted by character instead of by word.
  const words = Math.max(text.split(/\s+/).filter(Boolean).length, Math.ceil(text.length / 6));
  const base = Math.max(4000, 1500 + (words / WORDS_PER_MINUTE) * 60_000 + (scene.stepId ? 2500 : 0));
  return Math.round(base / (speed > 0 ? speed : 1));
}

const sceneName = (t: T, scene: StoryScene) => tr(t, `story.scene.${scene.id}`, SCENE_NAMES[scene.id]);
const clampIndex = (value: number, count: number) => Math.min(count - 1, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
const INTERACTIVE = 'button, a, summary, [role="button"], [role="radio"], [role="tab"]';
/** What a screen reader hears when the scene changes: where the reader is, then the scene itself. */
const sceneAnnouncement = (t: T, scenes: StoryScene[], to: number) => `${t('story.scene', { n: to + 1, total: scenes.length })}: ${sceneName(t, scenes[to])}. ${scenes[to].onScreen} ${scenes[to].narration}`;

function Player({ explanation, t, initialScene = 0, onSceneChange, reducedMotion }: StoryPlayerProps) {
  const scenes = explanation.scenes;
  const count = scenes.length;
  const systemReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? systemReduced;

  const [index, setIndex] = useState(() => clampIndex(initialScene, count));
  const [wantsPlay, setWantsPlay] = useState(false);
  const [speed, setSpeed] = useState<StorySpeed>(1);
  // Bumped by Replay so the timer starts over even when the scene itself does not change.
  const [run, setRun] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  // A step the reader chose in the diagram, kept only for the scene it was chosen in.
  const [stepChoice, setStepChoice] = useState<{ scene: number; step: number } | null>(null);
  // null until the reader opens or closes the transcript; until then it is open exactly when motion is reduced.
  const [transcriptChoice, setTranscriptChoice] = useState<boolean | null>(null);
  const speedRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Reading time already spent on the current scene, so pausing and resuming does not restart it.
  const elapsed = useRef(0);
  const resets = useRef(0);

  const playing = wantsPlay && !reduced;
  const scene = scenes[index];
  const dwell = sceneDwellMs(scene);
  const transcriptOpen = transcriptChoice ?? reduced;
  const sceneSteps = useMemo(() => scenes.map((s) => (s.stepId && explanation.visualization ? explanation.visualization.steps.findIndex((step) => step.id === s.stepId) : -1)), [scenes, explanation.visualization]);
  const sceneStep = sceneSteps[index];
  const step = stepChoice?.scene === index ? stepChoice.step : sceneStep;

  const show = (next: number) => {
    const to = clampIndex(next, count);
    if (to === index) return;
    elapsed.current = 0;
    resets.current += 1;
    setIndex(to);
    setStepChoice(null);
    setAnnouncement(sceneAnnouncement(t, scenes, to));
    onSceneChange?.(to, scenes[to]);
  };
  const restart = (play: boolean) => {
    elapsed.current = 0;
    resets.current += 1;
    setRun((r) => r + 1);
    show(0);
    setWantsPlay(play && !reduced);
  };
  const toggle = () => {
    if (reduced) return;
    // Play on the last scene after it has finished starts the story again.
    if (!playing && index === count - 1) restart(true);
    else setWantsPlay(!playing);
  };

  useEffect(() => {
    if (!playing) return;
    const token = resets.current;
    const started = Date.now();
    const timer = window.setTimeout(() => {
      if (index >= count - 1) { setWantsPlay(false); return; }
      const to = index + 1;
      elapsed.current = 0;
      resets.current += 1;
      setIndex(to);
      setStepChoice(null);
      setAnnouncement(sceneAnnouncement(t, scenes, to));
      onSceneChange?.(to, scenes[to]);
    }, Math.max(0, (dwell - elapsed.current) / speed));
    return () => {
      window.clearTimeout(timer);
      // Keep the time already read unless the scene was changed or restarted in the meantime.
      if (resets.current === token) elapsed.current += (Date.now() - started) * speed;
    };
  }, [playing, index, run, count, dwell, speed, scenes, t, onSceneChange]);

  // A hidden tab is not being read, so the story waits.
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setWantsPlay(false); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
    switch (e.key) {
      case ' ': {
        // On a control, Space belongs to that control.
        const control = target.closest(INTERACTIVE);
        if (control && e.currentTarget.contains(control)) return;
        toggle();
        break;
      }
      case 'k':
      case 'K': toggle(); break;
      case 'ArrowLeft': show(index - 1); break;
      case 'ArrowRight': show(index + 1); break;
      case 'Home': show(0); break;
      case 'End': show(count - 1); break;
      default: return;
    }
    e.preventDefault();
  };

  // Arrow keys inside the speed selector choose a speed, as in any radio group, instead of changing scene.
  const onSpeedKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    e.stopPropagation();
    const next = (STORY_SPEEDS.indexOf(speed) + move + STORY_SPEEDS.length) % STORY_SPEEDS.length;
    setSpeed(STORY_SPEEDS[next]);
    speedRefs.current[next]?.focus();
  };

  const pause = () => setWantsPlay(false);
  const name = sceneName(t, scene);

  return (
    <section className="story" aria-label={t('story.label')} data-playing={playing} data-reduced-motion={reduced ? 'true' : undefined} onKeyDown={onKeyDown}>
      <div className="story-progress" role="progressbar" aria-label={t('story.progress')} aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1} aria-valuetext={`${t('story.scene', { n: index + 1, total: count })}: ${name}`}>
        <span style={{ transform: `scaleX(${(index + 1) / count})` }} />
      </div>
      <ol className="story-scenes" aria-label={t('story.scenes')}>
        {scenes.map((s, i) => (
          <li key={s.id}>
            <button type="button" className="story-scene-btn t-num" aria-current={i === index ? 'step' : undefined} aria-label={t('story.sceneLabel', { n: i + 1, name: sceneName(t, s) })} onClick={() => show(i)}>{i + 1}</button>
          </li>
        ))}
      </ol>

      <div className="story-scene">
        {/* Keyed so only the words fade in on a scene change; the diagram stays mounted and keeps its measured size. */}
        <div key={scene.id} className="story-scene-text">
          <p className="flex flex-wrap items-center gap-2 t-meta t-num">
            <span>{t('story.scene', { n: index + 1, total: count })}</span>
            {scene.illustrative ? <span className="tag">{t('story.illustrative')}</span> : null}
          </p>
          <h3 className="t-card mt-1">{name}</h3>
          <p className="story-onscreen break-anywhere">{scene.onScreen}</p>
          <p className="t-body mt-3 text-fg2 measure break-anywhere">{scene.narration}</p>
        </div>
        {explanation.visualization && sceneStep >= 0 ? (
          // Touching the diagram means the reader is studying it, so the story stops moving on.
          <div className="mt-5" onPointerDown={pause} onKeyDown={pause} onFocus={pause}>
            <VisualizationView visualization={explanation.visualization} stepIndex={step} onStepChange={(to) => setStepChoice({ scene: index, step: to })} t={t} reducedMotion={reduced} compact arrowKeys={false} headingLevel={4} />
          </div>
        ) : null}
      </div>

      <div className="story-controls">
        <button type="button" className="btn" aria-disabled={index === 0} onClick={() => show(index - 1)}>
          <ChevronLeft size={16} aria-hidden="true" />{t('story.previous')}
        </button>
        {reduced ? null : (
          <button type="button" className="btn btn-primary" onClick={toggle}>
            {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{t(playing ? 'story.pause' : 'story.play')}
          </button>
        )}
        <button type="button" className="btn" aria-disabled={index === count - 1} onClick={() => show(index + 1)}>
          {t('story.next')}<ChevronRight size={16} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => restart(true)}>
          <RotateCcw size={15} aria-hidden="true" />{t(reduced ? 'story.restart' : 'story.replay')}
        </button>
        {reduced ? null : (
          <div role="radiogroup" aria-label={t('story.speed')} className="segmented" onKeyDown={onSpeedKeyDown}>
            {STORY_SPEEDS.map((s, i) => (
              <button key={s} ref={(el) => { speedRefs.current[i] = el; }} type="button" role="radio" aria-checked={s === speed} tabIndex={s === speed ? 0 : -1} className="t-num" onClick={() => setSpeed(s)}>{s}x</button>
            ))}
          </div>
        )}
      </div>
      <p className="t-meta mt-3 measure">{reduced ? `${t('story.manual')} ${t('story.shortcutsManual')}` : t('story.shortcuts')}</p>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <details className="viz-text" open={transcriptOpen} onToggle={(e) => { const now = e.currentTarget.open; if (now !== transcriptOpen) setTranscriptChoice(now); }}>
        <summary>{t('story.transcript')}</summary>
        <ol className="story-transcript">
          {scenes.map((s, i) => (
            <li key={s.id}>
              <h4 className="t-small font-semibold text-fg">{t('story.sceneLabel', { n: i + 1, name: sceneName(t, s) })}{s.illustrative ? <span className="font-normal text-fg2"> ({t('story.illustrative')})</span> : null}</h4>
              <p className="t-small font-medium break-anywhere">{s.onScreen}</p>
              <p className="t-small text-fg2 measure break-anywhere">{s.narration}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

/** The Story Mode player. Explanation data is validated again here; invalid data shows a note instead of a player. */
export function StoryPlayer({ explanation, ...rest }: StoryPlayerProps) {
  const parsed = useMemo(() => parseExplanation(explanation), [explanation]);
  if (!parsed) return <p className="learn-note" role="note">{rest.t('learn.unavailable')}</p>;
  return <Player explanation={parsed} {...rest} />;
}
