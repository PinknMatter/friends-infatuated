// Owns the boxes. INVARIANT: this is the only module that ever mutates box
// rects — effects receive Readonly<Rect> and style-mutate inside it.

import type p5 from 'p5';
import { buildTree, computeLeafRects, type BSPNode, type Rect } from './bsp';
import { fitText, type TextLayout } from './fitText';
import { RNG } from '../core/rng';
import type { ParamStore } from '../core/params';
import type { SentenceStore } from '../data/sentences';
import { neutralStyle, type BoxStyle } from '../effects/types';

export interface TextBox {
  id: number;
  sentence: string;
  words: string[];
  rect: Readonly<Rect>;
  layout: TextLayout | null;
  fitW: number; // inner size the current layout was fitted for
  fitH: number;
  fontId: string; // per-box font, resolved through the fonts registry (one entry stage 1)
  style: BoxStyle;
  intensityOffset: number; // cascade writes this; renderer clamps per-frame
  contentChangedAt: number; // typewriter retrigger anchor
}

interface BoxAnim {
  box: TextBox;
  leafSlot: number; // index into current leaf rect list
  fromRect: Rect;
  transStart: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class LayoutEngine {
  boxes: TextBox[] = [];

  private params: ParamStore;
  private store: SentenceStore;
  private tree: BSPNode | null = null;
  private anims: BoxAnim[] = [];
  private nextBoxId = 0;
  private sentenceCursor = 0;
  private breatheAmount = 0;
  private time = 0;
  private reshufflePending = false;
  private lastAddReshuffle = 0;
  private pendingAdds = 0;
  private stage: Rect = { x: 0, y: 0, w: 1920, h: 1080 };

  constructor(params: ParamStore, store: SentenceStore, width: number, height: number) {
    this.params = params;
    this.store = store;
    this.stage = { x: 0, y: 0, w: width, h: height };
    params.onChange('layout/reshuffle', () => this.requestReshuffle());
    store.onAdded(() => {
      this.pendingAdds++;
    });
  }

  requestReshuffle(): void {
    this.reshufflePending = true;
  }

  /** Called by gridBreathe (via LayoutHandle). Reset to 0 by the renderer each frame. */
  setBreathe(amount: number): void {
    this.breatheAmount = amount;
  }

  resetFrameState(): void {
    this.breatheAmount = 0;
  }

  update(g: p5.Graphics, time: number, dt: number): void {
    this.time = time;

    // Batch new-sentence reshuffles.
    if (
      this.pendingAdds > 0 &&
      time - this.lastAddReshuffle > this.params.num('layout/reshuffleBatchSecs')
    ) {
      this.pendingAdds = 0;
      this.lastAddReshuffle = time;
      this.reshufflePending = true;
    }

    if (this.reshufflePending || this.tree === null) {
      this.reshufflePending = false;
      this.reshuffle(g, time);
    }

    this.applyRects(g, time);
  }

  private reshuffle(g: p5.Graphics, time: number): void {
    const seed = this.params.num('master/seed') + Math.floor(time * 1000);
    const rng = new RNG(seed);

    const minBoxes = this.params.num('layout/minBoxes');
    const maxBoxes = Math.max(minBoxes, this.params.num('layout/maxBoxes'));
    const target = rng.int(minBoxes, maxBoxes);

    this.tree = buildTree(rng, this.stage, {
      targetLeaves: target,
      minW: this.params.num('layout/minBoxW'),
      minH: this.params.num('layout/minBoxH'),
      ratioLow: this.params.num('layout/splitBiasLow'),
      ratioHigh: this.params.num('layout/splitBiasHigh'),
    });

    const leaves = computeLeafRects(this.tree, this.stage, null).map((l) =>
      this.applyGutter(l.rect),
    );

    // Pair sentences to rects: longest sentences → largest boxes.
    const pool = this.store.getAll();
    const picked: string[] = [];
    for (let i = 0; i < leaves.length; i++) {
      picked.push(pool[(this.sentenceCursor + i) % pool.length]);
    }
    this.sentenceCursor = (this.sentenceCursor + leaves.length) % pool.length;

    const rectOrder = leaves
      .map((r, slot) => ({ slot, area: r.w * r.h }))
      .sort((a, b) => b.area - a.area);
    const byLength = [...picked].sort((a, b) => b.length - a.length);
    const slotSentence = new Map<number, string>();
    rectOrder.forEach((entry, i) => slotSentence.set(entry.slot, byLength[i]));

    // Match old boxes to new slots by nearest center so tweens read as motion.
    const oldAnims = this.anims;
    const newAnims: BoxAnim[] = [];
    const takenOld = new Set<number>();

    for (let slot = 0; slot < leaves.length; slot++) {
      const rect = leaves[slot];
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      let bestIdx = -1;
      let bestDist = Infinity;
      oldAnims.forEach((a, i) => {
        if (takenOld.has(i)) return;
        const ocx = a.box.rect.x + a.box.rect.w / 2;
        const ocy = a.box.rect.y + a.box.rect.h / 2;
        const d = (ocx - cx) ** 2 + (ocy - cy) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      });

      const sentence = slotSentence.get(slot)!;
      let box: TextBox;
      let fromRect: Rect;
      if (bestIdx >= 0) {
        takenOld.add(bestIdx);
        box = oldAnims[bestIdx].box;
        fromRect = { ...box.rect };
        if (box.sentence !== sentence) {
          box.sentence = sentence;
          box.words = sentence.split(/\s+/).filter(Boolean);
          box.contentChangedAt = time;
          box.layout = null;
        }
      } else {
        box = {
          id: this.nextBoxId++,
          sentence,
          words: sentence.split(/\s+/).filter(Boolean),
          rect: { ...rect },
          layout: null,
          fitW: 0,
          fitH: 0,
          fontId: this.params.str('master/fontId'),
          style: neutralStyle(),
          intensityOffset: 0,
          contentChangedAt: time,
        };
        fromRect = { ...rect };
      }
      newAnims.push({ box, leafSlot: slot, fromRect, transStart: time });
    }

    this.anims = newAnims;
    this.boxes = newAnims.map((a) => a.box);
  }

  private applyGutter(r: Rect): Rect {
    const gutter = this.params.num('layout/gutter') / 2;
    return { x: r.x + gutter, y: r.y + gutter, w: r.w - gutter * 2, h: r.h - gutter * 2 };
  }

  /** Tween boxes toward their (possibly breathing) target rects and refit text. */
  private applyRects(g: p5.Graphics, time: number): void {
    if (!this.tree) return;
    const breathe =
      this.breatheAmount > 0 ? { amount: this.breatheAmount, time } : null;
    const leaves = computeLeafRects(this.tree, this.stage, breathe);
    const dur = Math.max(0.05, this.params.num('layout/transitionDur'));

    for (const anim of this.anims) {
      const target = this.applyGutter(leaves[anim.leafSlot].rect);
      const t = Math.min(1, (time - anim.transStart) / dur);
      const e = easeInOut(t);
      const rect = anim.box.rect as Rect;
      rect.x = anim.fromRect.x + (target.x - anim.fromRect.x) * e;
      rect.y = anim.fromRect.y + (target.y - anim.fromRect.y) * e;
      rect.w = anim.fromRect.w + (target.w - anim.fromRect.w) * e;
      rect.h = anim.fromRect.h + (target.h - anim.fromRect.h) * e;

      const pad = this.params.num('layout/padding');
      const innerW = Math.max(8, rect.w - pad * 2);
      const innerH = Math.max(8, rect.h - pad * 2);
      const box = anim.box;
      // Refit only when the inner size actually moved (bucketed, so tween
      // frames mostly hit the fitText cache anyway).
      if (
        box.layout === null ||
        Math.abs(innerW - box.fitW) > 3 ||
        Math.abs(innerH - box.fitH) > 3
      ) {
        box.layout = fitText(g, box.sentence, innerW, innerH, box.fontId);
        box.fitW = innerW;
        box.fitH = innerH;
      }
    }
  }
}
