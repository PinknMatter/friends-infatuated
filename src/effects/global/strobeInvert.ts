// Full-frame invert on beat. HARD photosensitivity cap: never more than
// 4 flashes/sec regardless of params (maxRate param is clamped in the registry
// definition too, but we re-clamp here — belt and suspenders).

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';
import { frameFlags } from '../../render/frameFlags';

const ABSOLUTE_MAX_RATE = 4; // flashes/sec, non-negotiable
const FLASH_LEN = 0.07; // secs the invert holds

let lastFlash = -10;

export const strobeInvert: GlobalEffect = {
  id: 'strobeInvert',
  kind: 'global',

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.3) return; // needs conviction to strobe at all
    const maxRate = Math.min(ABSOLUTE_MAX_RATE, ctx.params.num('fx/strobeInvert/maxRate'));
    const minGap = 1 / maxRate;
    if (ctx.audio.beat && ctx.time - lastFlash >= minGap) {
      lastFlash = ctx.time;
    }
    if (ctx.time - lastFlash < FLASH_LEN) {
      frameFlags.invert = 1;
    }
  },
};
