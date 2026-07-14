// Continuous split-ratio perturbation driven by the low band. Rect mutation
// stays inside the layout engine — we only hand it an amount.

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const gridBreathe: GlobalEffect = {
  id: 'gridBreathe',
  kind: 'global',

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.02) return;
    const amount = ctx.params.num('fx/gridBreathe/amount');
    ctx.layout.setBreathe(amount * intensity * (0.35 + 0.65 * ctx.audio.bands.low));
  },
};
