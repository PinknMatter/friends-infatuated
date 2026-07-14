// Periodically triggers a layout reshuffle; interval shrinks as chaos rises.

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

let lastFire = 0;

export const layoutReshuffle: GlobalEffect = {
  id: 'layoutReshuffle',
  kind: 'global',
  incompatibleWith: ['typewriter'],

  onPhaseEnter(ctx: EffectCtx) {
    lastFire = ctx.time; // don't fire instantly on phase entry
  },

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.05) return;
    const base = ctx.params.num('fx/layoutReshuffle/baseInterval');
    const chaos = ctx.params.num('phases/chaos');
    const interval = (base * (1 - 0.8 * chaos)) / Math.max(0.2, intensity);
    if (ctx.time - lastFire > interval) {
      lastFire = ctx.time;
      ctx.layout.requestReshuffle();
    }
  },
};
