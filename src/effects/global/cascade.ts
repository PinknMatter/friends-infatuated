// Ripples effect intensity across boxes in reading order via per-box
// intensity offsets (consumed by the renderer's box-effect loop).

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const cascade: GlobalEffect = {
  id: 'cascade',
  kind: 'global',

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.02 || boxes.length === 0) return;
    const perBoxDelay = ctx.params.num('fx/cascade/perBoxDelay');
    const cycle = Math.max(1.5, perBoxDelay * boxes.length * 2);
    boxes.forEach((box, i) => {
      const phase = ((ctx.time - i * perBoxDelay) / cycle) % 1;
      // Wave in [-0.6, +0.4]: boxes ahead of the ripple get suppressed,
      // the ripple crest boosts.
      const wave = Math.sin(phase * Math.PI * 2) * 0.5 - 0.1;
      box.intensityOffset += wave * intensity;
    });
  },
};
