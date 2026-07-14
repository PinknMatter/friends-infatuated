// Random words toggle UPPERCASE. Slow. Uppercased words render slightly
// smaller (per-word scale) so the wider glyphs stay inside the fitted line.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const caseFlip: BoxEffect = {
  id: 'caseFlip',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const rate = ctx.params.num('fx/caseFlip/rate');
    const epoch = Math.floor(ctx.time * rate);
    for (let wi = 0; wi < box.words.length; wi++) {
      if (hash01(box.id * 53.1 + wi * 29.7 + epoch * 3.1) < 0.25 * intensity) {
        const prev = style.perWord.get(wi) ?? {};
        style.perWord.set(wi, { ...prev, upper: true, scale: (prev.scale ?? 1) * 0.82 });
      }
    }
  },
};

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
