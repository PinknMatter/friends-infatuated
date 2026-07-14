// Effect system contracts. Effects NEVER touch box rects (layout engine's job) —
// they mutate the per-frame BoxStyle, scaled by intensity (lerp from neutral).

import type p5 from 'p5';
import type { RNG } from '../core/rng';
import type { ParamReader } from '../core/params';
import type { TextBox } from '../layout/layoutEngine';

export interface AudioFrame {
  bands: { low: number; mid: number; high: number }; // smoothed 0..1
  beat: boolean; // true on the frame a beat fires (clock-derived)
  energy: number; // overall 0..1
}

/** Handle for global effects that need to ask the layout engine for things.
 *  The engine still owns all rect mutation. */
export interface LayoutHandle {
  requestReshuffle(): void;
  setBreathe(amount: number): void;
}

export interface EffectCtx {
  g: p5.Graphics; // 2D layer; only compositing effects (asciiCamera) draw here directly
  time: number;
  dt: number;
  audio: AudioFrame;
  rng: RNG; // seeded, deterministic per phase
  params: ParamReader;
  layout: LayoutHandle;
  log(text: string): void; // surfaces in control panel status area
}

export interface WordOverride {
  fill?: string;
  boxFill?: string;
  scale?: number;
  upper?: boolean;
  hidden?: boolean;
}

/** Mutable per-frame style. Reset to neutral each frame, effects compose into it. */
export interface BoxStyle {
  fill: string;
  opacity: number; // 0..1 whole box text alpha
  boxFill: string | null;
  boxOpacity: number;
  letterSpacing: number; // extra tracking as fraction of fontSize (renderer clamps per line)
  justify: 'left' | 'center' | 'right';
  vJustify: 'top' | 'center' | 'bottom';
  sizeScale: number; // ≤ 1, scales around rect center so fit is never exceeded
  visibleChars: number; // -1 = all
  dim: number; // 0..1, multiplies opacity down (spotlight)
  perWord: Map<number, WordOverride>;
  charOverrides: Map<number, string>; // global char index → replacement glyph (scramble)
  ghosts: { dx: number; dy: number; alpha: number }[];
}

export function resetStyle(s: BoxStyle): void {
  s.fill = '#ffffff';
  s.opacity = 1;
  s.boxFill = null;
  s.boxOpacity = 0;
  s.letterSpacing = 0;
  s.justify = 'left';
  s.vJustify = 'top';
  s.sizeScale = 1;
  s.visibleChars = -1;
  s.dim = 0;
  s.perWord.clear();
  s.charOverrides.clear();
  s.ghosts.length = 0;
}

export function neutralStyle(): BoxStyle {
  const s = {
    fill: '#ffffff',
    opacity: 1,
    boxFill: null,
    boxOpacity: 0,
    letterSpacing: 0,
    justify: 'left',
    vJustify: 'top',
    sizeScale: 1,
    visibleChars: -1,
    dim: 0,
    perWord: new Map(),
    charOverrides: new Map(),
    ghosts: [],
  } as BoxStyle;
  return s;
}

interface EffectBase {
  id: string;
  incompatibleWith?: string[];
  /** Scheduler hint: while this effect fires, others should calm down. */
  wantsSolo?: boolean;
  /** Live flag read by the scheduler when wantsSolo (e.g. similarWords mid-flash). */
  soloActive?: boolean;
  /** Called when a phase containing this effect begins (typewriter retrigger etc.). */
  onPhaseEnter?(ctx: EffectCtx): void;
}

export interface BoxEffect extends EffectBase {
  kind: 'box';
  // intensity 0–1 is the crossfade weight from the phase scheduler
  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx): void;
}

export interface GlobalEffect extends EffectBase {
  kind: 'global';
  update(boxes: TextBox[], intensity: number, ctx: EffectCtx): void;
}

export type Effect = BoxEffect | GlobalEffect;
