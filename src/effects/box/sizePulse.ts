// Text sizeScale pulses with the low band. Scale never exceeds 1 — the fitted
// size is the ceiling, so text can never escape its rect.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const sizePulse: BoxEffect = {
  id: 'sizePulse',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const depth = ctx.params.num('fx/sizePulse/depth');
    // Low band pushes scale up toward 1; quiet = shrunk by depth.
    const pulse = 1 - depth * (1 - ctx.audio.bands.low);
    // Slight per-box desync so the grid doesn't pump in perfect unison.
    const wobble = 1 - 0.06 * depth * (0.5 + 0.5 * Math.sin(ctx.time * 2.2 + box.id * 1.7));
    const target = Math.min(1, pulse * wobble);
    style.sizeScale *= 1 - (1 - target) * intensity;
  },
};
