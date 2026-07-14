// Decode effect: letters temporarily replaced with random glyphs, then resolve
// left-to-right over resolveTime.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const GLYPHS = '!<>-_\\/[]{}—=+*^?#@$%&01';

interface State {
  eventStart: number;
}

const states = new Map<number, State>();

export const scramble: BoxEffect = {
  id: 'scramble',
  kind: 'box',
  incompatibleWith: ['typewriter'],

  onPhaseEnter() {
    states.clear();
  },

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    if (!box.layout) return;
    const rate = ctx.params.num('fx/scramble/rate');
    const resolveTime = ctx.params.num('fx/scramble/resolveTime');

    let st = states.get(box.id);
    if (!st) {
      st = { eventStart: -100 };
      states.set(box.id, st);
    }
    // Decode events launch ON the beat, deterministically staggered per box
    // (default rate 0.6 → each box decodes roughly every 6-7 beats).
    if (ctx.audio.beat && ctx.time - st.eventStart > resolveTime) {
      const beatIndex = Math.round(ctx.audio.beatPos);
      if (hash01(box.id * 41.3 + beatIndex * 9.7) < rate * 0.25) {
        st.eventStart = ctx.time;
      }
    }

    const elapsed = ctx.time - st.eventStart;
    if (elapsed < 0 || elapsed > resolveTime || intensity <= 0.02) return;

    const total = box.layout.charCount;
    // Resolve front moves left→right; chars behind it are settled.
    const front = (elapsed / resolveTime) * total;
    // Intensity limits how deep past the front the scramble reaches.
    const reach = front + total * (1 - elapsed / resolveTime) * intensity;
    // Re-roll glyphs a few times a second, not every frame.
    const jitterEpoch = Math.floor(ctx.time * 15);
    for (let ci = Math.floor(front); ci < Math.min(total, Math.ceil(reach)); ci++) {
      const h = hash01(ci * 7.3 + jitterEpoch * 3.7 + box.id * 11.1);
      style.charOverrides.set(ci, GLYPHS[Math.floor(h * GLYPHS.length)]);
    }
  },
};

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
