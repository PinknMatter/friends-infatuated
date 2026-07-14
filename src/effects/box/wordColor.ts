// Random words change fill color from a palette; flicker rate rides the high band.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const PALETTES: Record<string, string[]> = {
  neon: ['#ff2a6d', '#05d9e8', '#f9f002', '#d1f7ff'],
  acid: ['#b6ff00', '#ff6ec7', '#00ffd5'],
  ice: ['#a8d8ff', '#e0f7ff', '#6bb8ff'],
  blood: ['#ff2222', '#ff6644', '#aa0000'],
};

interface State {
  colors: Map<number, string>;
  nextRefresh: number;
}

const states = new Map<number, State>();

export const wordColor: BoxEffect = {
  id: 'wordColor',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const palette = PALETTES[ctx.params.str('fx/wordColor/palette')] ?? PALETTES.neon;
    const flicker = ctx.params.num('fx/wordColor/flickerRate');
    // Refresh interval shrinks with flicker param and high-band energy.
    const interval = 1.5 / (0.2 + flicker * 3 * (0.3 + ctx.audio.bands.high));

    let st = states.get(box.id);
    if (!st || ctx.time > st.nextRefresh) {
      const colors = new Map<number, string>();
      for (let wi = 0; wi < box.words.length; wi++) {
        if (ctx.rng.chance(0.3)) colors.set(wi, ctx.rng.pick(palette));
      }
      st = { colors, nextRefresh: ctx.time + interval };
      states.set(box.id, st);
    }

    if (intensity <= 0.02) return;
    for (const [wi, color] of st.colors) {
      // Probabilistic gate by intensity so low intensity = fewer colored words.
      if (hash01(box.id * 131 + wi * 7) > intensity) continue;
      const prev = style.perWord.get(wi) ?? {};
      style.perWord.set(wi, { ...prev, fill: color });
    }
  },
};

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
