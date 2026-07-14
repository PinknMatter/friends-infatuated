// Tracking oscillates per box; mid band modulates amplitude. Renderer clamps
// spacing per line so text never escapes the rect.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

export const letterSpacingDrift: BoxEffect = {
  id: 'letterSpacingDrift',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const amount = ctx.params.num('fx/letterSpacingDrift/amount');
    const rate = ctx.params.num('fx/letterSpacingDrift/rate');
    const amp = amount * (0.3 + 0.7 * ctx.audio.bands.mid);
    // Oscillation period locked to the beat grid (default rate 0.4 → 5 beats).
    const osc = Math.sin(ctx.audio.beatPos * rate * Math.PI + box.id * 2.39);
    // Fraction of fontSize; renderer clamps to available line slack.
    style.letterSpacing += osc * 0.25 * amp * intensity;
  },
};
