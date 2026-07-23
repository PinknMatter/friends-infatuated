// Owns the boxes. INVARIANT: this is the only module that ever mutates box
// rects — effects receive Readonly<Rect> and style-mutate inside it.

import type p5 from 'p5';
import {
  applyMorphT,
  buildTree,
  computeLeafRects,
  retargetRatios,
  type BSPNode,
  type Rect,
} from './bsp';
import { fitText, type TextLayout } from './fitText';
import { resolveFont } from '../core/fonts';
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
  // Sentence lifecycle: type in → live (randomized span) → type out → respawn.
  spawnAt: number; // when type-in starts (may be slightly in the future)
  lifetime: number; // seconds of 'live' after type-in completes
  outStart: number; // when type-out began (-1 = not dying)
  /** Chars currently visible per the lifecycle; -1 = all (renderer min()s
   *  this with effect-driven visibleChars). */
  lifeVisible: number;
}

interface BoxAnim {
  box: TextBox;
  leafSlot: number; // index into current leaf rect list
  fromRect: Rect;
  transStart: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Flash spawn: whole sentence blinks (all/none) for this long after spawnAt,
// then holds fully visible; death is an instant cut (no backspace).
const FLASH_FLICKER_SECS = 0.3;
const FLASH_BLINK_SECS = 0.06;

export class LayoutEngine {
  boxes: TextBox[] = [];

  private params: ParamStore;
  private store: SentenceStore;
  private tree: BSPNode | null = null;
  private anims: BoxAnim[] = [];
  private nextBoxId = 0;
  private builtinCursor = 0;
  private externalCursor = 0;
  private mixRng = new RNG(0xd1ce); // side RNG for the DB/builtin draw only
  private takeoverLogged = false;
  private log: (text: string) => void;
  private breatheAmount = 0;
  private time = 0;
  private reshufflePending = false;
  private morphPending = false;
  private morphStart = -Infinity;
  private lifeRng = new RNG(0xf00d);
  private drive = 1; // tempo×energy motion multiplier from the renderer
  private lastAddReshuffle = 0;
  private pendingAdds = 0;
  private stage: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
  // QR takeover: every box shows this one sentence (typewriter face, few huge
  // boxes) while set — the effect pipeline runs on it like any other content.
  private pinned: string | null = null;
  private restartPending = false;

  constructor(
    params: ParamStore,
    store: SentenceStore,
    width: number,
    height: number,
    log: (text: string) => void = () => {},
  ) {
    this.params = params;
    this.store = store;
    this.log = log;
    this.stage = { x: 0, y: 0, w: width, h: height };
    params.onChange('layout/reshuffle', () => this.requestReshuffle());
    params.onChange('layout/morph', () => this.requestMorph());
    params.onChange('layout/maxFontPx', () => {
      for (const box of this.boxes) box.layout = null; // force refit at new cap
    });
    store.onAdded(() => {
      this.pendingAdds++;
    });
  }

  requestReshuffle(): void {
    this.reshufflePending = true;
  }

  /** Pin the whole layout to one sentence (null = back to the pools). */
  setPinnedSentence(sentence: string | null): void {
    if (sentence === this.pinned) return;
    this.pinned = sentence;
    this.requestReshuffle();
  }

  /** Fresh start (blackout exit): new grid AND every box re-types from
   *  nothing, staggered — instead of reappearing mid-phase. */
  restartLifecycles(): void {
    this.restartPending = true;
    this.reshufflePending = true;
  }

  /** Shift the whole grid as a unit: every split ratio glides to a new value,
   *  boxes keep their slots/sentences and reflow together. */
  requestMorph(): void {
    this.morphPending = true;
  }

  /** Called by gridBreathe (via LayoutHandle). Reset to 0 by the renderer each frame. */
  setBreathe(amount: number): void {
    this.breatheAmount = amount;
  }

  resetFrameState(): void {
    this.breatheAmount = 0;
  }

  update(g: p5.Graphics, time: number, dt: number, drive = 1): void {
    this.time = time;
    this.drive = drive;

    // Batch new-sentence reshuffles.
    if (
      this.pendingAdds > 0 &&
      time - this.lastAddReshuffle > this.params.num('layout/reshuffleBatchSecs')
    ) {
      this.pendingAdds = 0;
      this.lastAddReshuffle = time;
      this.reshufflePending = true;
    }

    this.updateLifecycles(time);

    if (this.reshufflePending || this.tree === null) {
      this.reshufflePending = false;
      this.morphStart = -Infinity; // a rebuild supersedes any running morph
      this.reshuffle(g, time);
    } else if (this.morphPending && this.tree) {
      this.morphPending = false;
      const rng = new RNG(this.params.num('master/seed') + Math.floor(time * 1000));
      retargetRatios(
        this.tree,
        rng,
        this.params.num('layout/splitBiasLow'),
        this.params.num('layout/splitBiasHigh'),
      );
      this.morphStart = time;
    }

    // Advance a running grid morph (eased; all nodes move in lockstep).
    if (this.tree && time - this.morphStart >= 0) {
      const dur = Math.max(0.05, this.params.num('layout/morphDur'));
      const t = Math.min(1, (time - this.morphStart) / dur);
      applyMorphT(this.tree, easeInOut(t));
    }

    this.applyRects(g, time);
  }

  private reshuffle(g: p5.Graphics, time: number): void {
    const seed = this.params.num('master/seed') + Math.floor(time * 1000);
    const rng = new RNG(seed);

    const minBoxes = this.params.num('layout/minBoxes');
    const maxBoxes = Math.max(minBoxes, this.params.num('layout/maxBoxes'));
    // Pinned takeover reads as a monolith: a few huge boxes, whatever the
    // scene params say (they are restored untouched when unpinned).
    const target = this.pinned ? rng.int(2, 4) : rng.int(minBoxes, maxBoxes);

    this.tree = buildTree(rng, this.stage, {
      targetLeaves: target,
      minW: this.params.num('layout/minBoxW'),
      minH: this.params.num('layout/minBoxH'),
      ratioLow: this.params.num('layout/splitBiasLow'),
      ratioHigh: this.params.num('layout/splitBiasHigh'),
      rowBias: this.params.num('layout/rowBias'),
    });

    const leaves = computeLeafRects(this.tree, this.stage, null).map((l) =>
      this.applyGutter(l.rect),
    );

    // Pair sentences to rects: longest sentences → largest boxes.
    const picked: string[] = [];
    for (let i = 0; i < leaves.length; i++) {
      picked.push(this.nextSentence());
    }

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
          this.respawn(box, sentence, time);
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
          spawnAt: time + this.lifeRng.range(0, 1.2), // stagger type-ins
          lifetime: this.rollLifetime(),
          outStart: -1,
          lifeVisible: 0,
        };
        fromRect = { ...rect };
      }
      newAnims.push({ box, leafSlot: slot, fromRect, transStart: time });
    }

    this.anims = newAnims;
    this.boxes = newAnims.map((a) => a.box);

    // Reshuffle is the font boundary: pinned boxes wear the typewriter face,
    // everything else follows master/fontId (reused boxes included).
    const fontId = this.pinned ? 'typewriter' : this.params.str('master/fontId');
    for (const box of this.boxes) {
      if (box.fontId !== fontId) {
        box.fontId = fontId;
        box.layout = null; // refit with the new face
      }
    }

    // Fresh start: reused boxes would otherwise stay fully visible — force
    // EVERY box (kept sentences included) to type in from nothing.
    if (this.restartPending) {
      this.restartPending = false;
      for (const box of this.boxes) this.respawn(box, box.sentence, time);
    }
  }

  // ---- sentence lifecycle: type in → live → type out → respawn ----

  private rollLifetime(): number {
    const min = this.params.num('layout/lifeMin');
    const max = Math.max(min, this.params.num('layout/lifeMax'));
    // Fast/loud music shortens lives; breakdowns stretch them.
    return this.lifeRng.range(min, max) / this.drive;
  }

  /** Weighted draw between the crowd (external) pool and the builtin pool.
   *  data/dbMix sets the crowd fraction; at data/dbTakeoverAt crowd sentences
   *  the builtins retire entirely. Each pool keeps its own cursor. */
  private nextSentence(): string {
    if (this.pinned) return this.pinned;
    const external = this.store.getExternal();
    let mix: number;
    if (external.length === 0) {
      mix = 0;
    } else if (external.length >= this.params.num('data/dbTakeoverAt')) {
      mix = 1;
      if (!this.takeoverLogged) {
        this.takeoverLogged = true;
        this.log(`crowd takeover: ${external.length} sentences, builtins retired`);
      }
    } else {
      mix = this.params.num('data/dbMix');
    }
    if (this.mixRng.next() < mix) {
      const s = external[this.externalCursor % external.length];
      this.externalCursor = (this.externalCursor + 1) % external.length;
      return s;
    }
    const builtin = this.store.getBuiltin();
    const s = builtin[this.builtinCursor % builtin.length];
    this.builtinCursor = (this.builtinCursor + 1) % builtin.length;
    return s;
  }

  private respawn(box: TextBox, sentence: string, time: number): void {
    box.sentence = sentence;
    box.words = sentence.split(/\s+/).filter(Boolean);
    box.contentChangedAt = time;
    box.layout = null;
    box.spawnAt = time + this.lifeRng.range(0.05, 0.7) / this.drive;
    box.lifetime = this.rollLifetime();
    box.outStart = -1;
    box.lifeVisible = 0;
  }

  private updateLifecycles(time: number): void {
    if (!this.params.bool('layout/lifecycle')) {
      for (const box of this.boxes) box.lifeVisible = -1;
      return;
    }
    const spawnStyle = this.params.str('layout/spawnStyle');
    if (spawnStyle === 'flash') {
      this.updateFlashLifecycles(time);
      return;
    }
    if (spawnStyle === 'strobe') {
      this.updateStrobeLifecycles(time);
      return;
    }
    const inSpeed = this.params.num('layout/typeInSpeed') * this.drive;
    const outSpeed = this.params.num('layout/typeOutSpeed') * this.drive;
    for (const box of this.boxes) {
      const total = box.layout?.charCount ?? box.sentence.length;

      if (box.outStart >= 0) {
        // Typing out (backspace from the end).
        const remaining = Math.floor(total - (time - box.outStart) * outSpeed);
        if (remaining <= 0) {
          this.respawn(box, this.nextSentence(), time);
        } else {
          box.lifeVisible = remaining;
        }
        continue;
      }
      if (time < box.spawnAt) {
        box.lifeVisible = 0;
        continue;
      }
      const typed = (time - box.spawnAt) * inSpeed;
      if (typed < total) {
        box.lifeVisible = Math.floor(typed);
        continue;
      }
      // Fully typed: live until the randomized lifetime runs out.
      const typeInDur = total / inSpeed;
      if (time > box.spawnAt + typeInDur + box.lifetime) {
        box.outStart = time;
        box.lifeVisible = total;
      } else {
        box.lifeVisible = -1;
      }
    }
  }

  /** Flash spawn style: the sentence appears WHOLE with a short blink flicker,
   *  lives its span, then cuts to nothing instantly. Type speeds unused. */
  private updateFlashLifecycles(time: number): void {
    for (const box of this.boxes) {
      // A box caught mid-backspace when the style flipped just cuts now.
      if (box.outStart >= 0) {
        this.respawn(box, this.nextSentence(), time);
        continue;
      }
      const since = time - box.spawnAt;
      if (since < 0) {
        box.lifeVisible = 0;
        continue;
      }
      if (since < FLASH_FLICKER_SECS) {
        box.lifeVisible =
          Math.floor(since / FLASH_BLINK_SECS) % 2 === 0 ? -1 : 0;
        continue;
      }
      if (since > FLASH_FLICKER_SECS + box.lifetime) {
        this.respawn(box, this.nextSentence(), time); // instant cut, no backspace
      } else {
        box.lifeVisible = -1;
      }
    }
  }

  /** Strobe spawn style: instant swaps — the sentence pops in whole, lives a
   *  very short span, cuts, and a DIFFERENT sentence takes the slot the same
   *  frame. Per-box deterministic jitter desyncs the swaps so the wall
   *  shimmers instead of blinking in unison. */
  private updateStrobeLifecycles(time: number): void {
    const base = this.params.num('layout/strobeLifeSecs');
    for (const box of this.boxes) {
      // A box caught mid-backspace when the style flipped just swaps now.
      if (box.outStart >= 0) {
        this.strobeRespawn(box, time);
        continue;
      }
      const since = time - box.spawnAt;
      if (since < 0) {
        box.lifeVisible = 0;
        continue;
      }
      // Hash the box id into a stable 0.6..1.4× life factor (no stored state,
      // survives style flips mid-life; box.lifetime is rolled for type mode
      // and would strand boxes on multi-second lives here).
      const h = (Math.imul(box.id ^ 0x9e3779b9, 0x85ebca6b) >>> 16) / 0xffff;
      const life = (base * (0.6 + 0.8 * h)) / this.drive;
      if (since > life) {
        this.strobeRespawn(box, time);
      } else {
        box.lifeVisible = -1;
      }
    }
  }

  private strobeRespawn(box: TextBox, time: number): void {
    this.respawn(box, this.nextSentence(), time);
    box.spawnAt = time; // kill respawn()'s stagger: the next sentence lands NOW
    box.lifeVisible = -1;
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
        // fitText measures with whatever font g carries — set the box's own.
        g.textFont(resolveFont(box.fontId).family);
        box.layout = fitText(
          g,
          box.sentence,
          innerW,
          innerH,
          box.fontId,
          this.params.num('layout/maxFontPx'),
        );
        box.fitW = innerW;
        box.fitH = innerH;
      }
    }
  }
}
