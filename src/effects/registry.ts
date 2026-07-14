// All effects, in COMPOSITION ORDER — the renderer walks this list each frame.
// Order matters:
//   1. cascade first (writes per-box intensity offsets the box-effect loop reads)
//   2. asciiCamera next (paints the background layer under everything)
//   3. box effects (each lerps the style from neutral, scaled by intensity)
//   4. attention-grabbing globals last so their style writes win
//      (similarWords is the signature effect — it goes at the very end)

import type { Effect } from './types';
import { typewriter } from './box/typewriter';
import { wordBoxHighlight } from './box/wordBoxHighlight';
import { wordColor } from './box/wordColor';
import { sizePulse } from './box/sizePulse';
import { letterSpacingDrift } from './box/letterSpacingDrift';
import { justifyShift } from './box/justifyShift';
import { flashInOut } from './box/flashInOut';
import { caseFlip } from './box/caseFlip';
import { scramble } from './box/scramble';
import { ghostEcho } from './box/ghostEcho';
import { layoutReshuffle } from './global/layoutReshuffle';
import { gridBreathe } from './global/gridBreathe';
import { spotlight } from './global/spotlight';
import { cascade } from './global/cascade';
import { similarWords } from './global/similarWords';
import { strobeInvert } from './global/strobeInvert';
import { asciiCamera } from './compositing/asciiCamera';

export const EFFECTS: Effect[] = [
  cascade,
  asciiCamera,
  typewriter,
  wordBoxHighlight,
  wordColor,
  sizePulse,
  letterSpacingDrift,
  justifyShift,
  flashInOut,
  caseFlip,
  scramble,
  ghostEcho,
  layoutReshuffle,
  gridBreathe,
  strobeInvert,
  spotlight,
  similarWords,
];

export const effectById = new Map(EFFECTS.map((e) => [e.id, e]));

/** Selection weights per chaos regime. Box effects dominate early; global &
 *  compositing effects enter as chaos rises. */
export function selectionWeight(id: string, chaos: number): number {
  const effect = effectById.get(id);
  if (!effect) return 0;
  switch (id) {
    case 'asciiCamera':
      return chaos > 0.35 ? (chaos - 0.35) * 2.2 : 0;
    case 'strobeInvert':
      return chaos > 0.55 ? (chaos - 0.55) * 2.8 : 0;
    case 'similarWords':
      return 1.2; // signature effect — always a strong candidate
    case 'layoutReshuffle':
    case 'spotlight':
    case 'cascade':
    case 'gridBreathe':
      return 0.45 + chaos * 1.4;
    default:
      // Box effects: strong early, still present late.
      return 1 - chaos * 0.3;
  }
}
