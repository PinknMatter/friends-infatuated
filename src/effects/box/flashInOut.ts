// Whole boxes or individual words blink in/out, on beat subdivisions
// (rate 0.5 = per beat, 1 = 8th notes, ...). High band raises blink odds.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const flashInOut: BoxEffect = {
  id: 'flashInOut',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const probability =
      ctx.params.num('fx/flashInOut/probability') * (0.45 + 1.0 * ctx.audio.bands.high);
    const rate = ctx.params.num('fx/flashInOut/rate');
    const epoch = Math.floor(ctx.audio.beatPos * rate * 2);

    // Whole-box blink.
    if (hash01(box.id * 91.7 + epoch * 13.3) < probability * 0.4) {
      style.opacity *= 1 - intensity;
      return;
    }
    // Word-level blinks.
    for (let wi = 0; wi < box.words.length; wi++) {
      if (hash01(box.id * 17.1 + wi * 71.3 + epoch * 5.7) < probability * 0.5 * intensity) {
        const prev = style.perWord.get(wi) ?? {};
        style.perWord.set(wi, { ...prev, hidden: true });
      }
    }
  },
};

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
