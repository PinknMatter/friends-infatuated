// 1–3 offset translucent copies of the text; offset rides audio energy.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const ghostEcho: BoxEffect = {
  id: 'ghostEcho',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.02) return;
    const copies = ctx.params.num('fx/ghostEcho/copies');
    const maxOffset = ctx.params.num('fx/ghostEcho/offset');
    // Energy or beat thump, whichever kicks harder.
    const thump = Math.exp(-(ctx.audio.beatPos % 1) * 4);
    const drive = 0.25 + 0.75 * Math.max(ctx.audio.energy, thump * 0.8);
    for (let i = 1; i <= copies; i++) {
      const angle = ctx.time * (0.7 + i * 0.35) + box.id * 1.3 + i * 2.1;
      const r = maxOffset * drive * intensity * (i / copies);
      style.ghosts.push({
        dx: Math.cos(angle) * r,
        dy: Math.sin(angle * 1.31) * r,
        alpha: 0.35 * intensity * (1 - (i - 1) / copies),
      });
    }
  },
};
