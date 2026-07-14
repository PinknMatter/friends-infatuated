// Text sizeScale pulses with the low band. Scale never exceeds 1 — the fitted
// size is the ceiling, so text can never escape its rect.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const sizePulse: BoxEffect = {
  id: 'sizePulse',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const depth = ctx.params.num('fx/sizePulse/depth');
    // Beat thump (sharp attack, exponential decay) OR low-band energy —
    // whichever is hotter — pushes scale up toward 1.
    const thump = Math.exp(-(ctx.audio.beatPos % 1) * 5);
    const drive = Math.max(ctx.audio.bands.low, thump * 0.85);
    const pulse = 1 - depth * (1 - drive);
    // Slight per-box desync so the grid doesn't pump in perfect unison.
    const wobble = 1 - 0.06 * depth * (0.5 + 0.5 * Math.sin(ctx.time * 2.2 + box.id * 1.7));
    const target = Math.min(1, pulse * wobble);
    style.sizeScale *= 1 - (1 - target) * intensity;
  },
};
