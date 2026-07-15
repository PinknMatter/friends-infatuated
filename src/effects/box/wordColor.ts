// Random words change fill color from a palette. Re-colors on beat
// subdivisions (flickerRate 0 = every 2 beats … 1 = every 16th note), so it
// rides the BPM — manual or detected. High band widens how many words color.

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
  epoch: number;
}

const states = new Map<number, State>();

export const wordColor: BoxEffect = {
  id: 'wordColor',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const palette = PALETTES[ctx.params.str('fx/wordColor/palette')] ?? PALETTES.neon;
    const flicker = ctx.params.num('fx/wordColor/flickerRate');
    // Beat-synced refresh: 0 → every 2 beats, 0.65 (default) → ~2.5×/beat,
    // 1 → 16th notes.
    const subdiv = 0.5 + flicker * 3.5;
    const epoch = Math.floor(ctx.audio.beatPos * subdiv);

    let st = states.get(box.id);
    if (!st || st.epoch !== epoch) {
      // High band widens coverage: more words light up when the top end hits.
      const coverage = 0.12 + 0.6 * ctx.audio.bands.high;
      const colors = new Map<number, string>();
      for (let wi = 0; wi < box.words.length; wi++) {
        if (ctx.rng.chance(coverage)) colors.set(wi, ctx.rng.pick(palette));
      }
      st = { colors, epoch };
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
