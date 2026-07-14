// One box gets attention (bright boxFill), others dim; rotates through boxes.

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const spotlight: GlobalEffect = {
  id: 'spotlight',
  kind: 'global',

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.02 || boxes.length === 0) return;
    const hold = ctx.params.num('fx/spotlight/holdSecs');
    const dimAmount = ctx.params.num('fx/spotlight/dimAmount');
    // Deterministic rotation order that reshuffles each full pass.
    const pass = Math.floor(ctx.time / (hold * boxes.length));
    const step = Math.floor(ctx.time / hold) % boxes.length;
    const chosen = boxes[(step * 7 + pass * 3) % boxes.length];

    for (const box of boxes) {
      if (box === chosen) {
        box.style.boxFill = '#ffffff';
        box.style.boxOpacity = Math.max(box.style.boxOpacity, 0.92 * intensity);
        box.style.fill = '#000000';
      } else {
        box.style.dim = Math.max(box.style.dim, dimAmount * intensity);
      }
    }
  },
};
