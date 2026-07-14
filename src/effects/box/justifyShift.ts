// Justification (L/C/R + vertical) snaps between values on beat or interval.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const H = ['left', 'center', 'right'] as const;
const V = ['top', 'center', 'bottom'] as const;

interface State {
  justify: (typeof H)[number];
  vJustify: (typeof V)[number];
  nextSwitch: number;
}

const states = new Map<number, State>();

export const justifyShift: BoxEffect = {
  id: 'justifyShift',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const onBeat = ctx.params.bool('fx/justifyShift/onBeat');
    const interval = ctx.params.num('fx/justifyShift/interval');

    let st = states.get(box.id);
    if (!st) {
      st = { justify: 'left', vJustify: 'top', nextSwitch: 0 };
      states.set(box.id, st);
    }
    const shouldSwitch = onBeat
      ? ctx.audio.beat && ctx.rng.chance(0.5)
      : ctx.time > st.nextSwitch;
    if (shouldSwitch) {
      st.justify = ctx.rng.pick(H);
      st.vJustify = ctx.rng.pick(V);
      st.nextSwitch = ctx.time + interval;
    }

    // Justification isn't lerpable — gate per box by intensity so the effect
    // fades in as a growing share of boxes participating.
    if (hash01(box.id * 37.7) < intensity) {
      style.justify = st.justify;
      style.vJustify = st.vJustify;
    }
  },
};

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
