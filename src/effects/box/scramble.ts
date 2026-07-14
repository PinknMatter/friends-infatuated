// Decode effect: letters temporarily replaced with random glyphs, then resolve
// left-to-right over resolveTime.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const GLYPHS = '!<>-_\\/[]{}—=+*^?#@$%&01';

interface State {
  eventStart: number;
  nextEvent: number;
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
      // Stagger first events so boxes don't all decode at once.
      st = { eventStart: -100, nextEvent: ctx.time + ctx.rng.range(0, 2 / rate) };
      states.set(box.id, st);
    }
    if (ctx.time > st.nextEvent) {
      st.eventStart = ctx.time;
      st.nextEvent = ctx.time + resolveTime + ctx.rng.range(0.5, 3) / rate;
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
