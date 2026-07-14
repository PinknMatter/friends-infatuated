// Reveal chars over time. Retriggers on new sentence (contentChangedAt) and on
// phase entry; beats advance extra chunks.

import type { BoxEffect, BoxStyle, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const BEAT_CHUNK = 4;

interface State {
  revealed: number;
  contentStamp: number;
}

const states = new Map<number, State>();
let phaseEnteredAt = 0;

export const typewriter: BoxEffect = {
  id: 'typewriter',
  kind: 'box',
  incompatibleWith: ['scramble', 'layoutReshuffle'],

  onPhaseEnter(ctx: EffectCtx) {
    phaseEnteredAt = ctx.time;
    states.clear();
  },

  apply(box: TextBox, style: BoxStyle, intensity: number, ctx: EffectCtx) {
    if (!box.layout) return;
    let st = states.get(box.id);
    if (!st || st.contentStamp !== box.contentChangedAt) {
      st = { revealed: 0, contentStamp: box.contentChangedAt };
      states.set(box.id, st);
    }

    const speed = ctx.params.num('fx/typewriter/speed');
    st.revealed += ctx.dt * speed;
    if (ctx.audio.beat && ctx.params.bool('fx/typewriter/beatAdvance')) {
      st.revealed += BEAT_CHUNK;
    }
    const total = box.layout.charCount;
    st.revealed = Math.min(total, st.revealed);

    // Intensity lerps from neutral (all visible) toward the reveal count.
    const visible = total - (total - st.revealed) * intensity;
    style.visibleChars = Math.floor(visible);
  },
};
