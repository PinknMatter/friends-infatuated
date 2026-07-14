// Random word(s) get a filled rect behind the whole word; re-picks flash on
// beat (or after holdTime expires).

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

interface State {
  words: number[];
  until: number;
}

const states = new Map<number, State>();

export const wordBoxHighlight: BoxEffect = {
  id: 'wordBoxHighlight',
  kind: 'box',

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    const hold = ctx.params.num('fx/wordBoxHighlight/holdTime');
    const count = ctx.params.num('fx/wordBoxHighlight/count');
    const color = ctx.params.str('fx/wordBoxHighlight/color');

    let st = states.get(box.id);
    const expired = !st || ctx.time > st.until;
    if (expired || (ctx.audio.beat && ctx.rng.chance(0.7))) {
      const picks: number[] = [];
      for (let i = 0; i < count && box.words.length > 0; i++) {
        picks.push(ctx.rng.int(0, box.words.length - 1));
      }
      st = { words: picks, until: ctx.time + hold };
      states.set(box.id, st);
    }

    if (!st || intensity <= 0.02) return;
    for (const wi of st.words) {
      const prev = style.perWord.get(wi) ?? {};
      style.perWord.set(wi, { ...prev, boxFill: color, fill: '#000000' });
    }
  },
};
