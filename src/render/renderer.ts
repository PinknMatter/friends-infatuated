// Frame orchestration: run the effect pipeline (styles only), draw every box's
// text from its cached layout, hand the 2D canvas to the post pass.
// Text drawing is the hot path — word layouts are cached in fitText and we only
// fall to per-char drawing when an effect actually needs it.

import type p5 from 'p5';
import type { ParamStore } from '../core/params';
import type { Clock } from '../core/clock';
import type { Transport } from '../core/transport';
import type { LayoutEngine, TextBox } from '../layout/layoutEngine';
import type { PhaseScheduler } from '../phases/scheduler';
import type { AudioAnalyser } from '../audio/analyser';
import { EFFECTS } from '../effects/registry';
import { resetStyle, type AudioFrame, type EffectCtx, type LayoutHandle } from '../effects/types';
import { frameFlags, resetFrameFlags } from './frameFlags';
import { PostPass } from './post/post';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class Renderer {
  private g: p5.Graphics;
  private params: ParamStore;
  private clock: Clock;
  private layout: LayoutEngine;
  private scheduler: PhaseScheduler;
  private audio: AudioAnalyser;
  private transport: Transport;
  private post: PostPass | null;
  private layoutHandle: LayoutHandle;

  private fpsFrames = 0;
  private fpsWindowStart = 0;
  private fps = 0;
  private lastStatusAt = 0;
  private lastAudio: AudioFrame = {
    bands: { low: 0, mid: 0, high: 0 },
    beat: false,
    energy: 0,
  };
  private beatSinceStatus = false;

  constructor(opts: {
    g: p5.Graphics;
    params: ParamStore;
    clock: Clock;
    layout: LayoutEngine;
    scheduler: PhaseScheduler;
    audio: AudioAnalyser;
    transport: Transport;
    post: PostPass | null;
  }) {
    this.g = opts.g;
    this.params = opts.params;
    this.clock = opts.clock;
    this.layout = opts.layout;
    this.scheduler = opts.scheduler;
    this.audio = opts.audio;
    this.transport = opts.transport;
    this.post = opts.post;
    this.layoutHandle = {
      requestReshuffle: () => this.layout.requestReshuffle(),
      setBreathe: (amount) => this.layout.setBreathe(amount),
    };
  }

  frame(time: number, dt: number): void {
    const g = this.g;
    const paused = this.params.bool('master/paused');

    this.clock.update(time);
    const audioFrame: AudioFrame = this.audio.update(time, dt);
    this.lastAudio = audioFrame;
    if (audioFrame.beat) this.beatSinceStatus = true;

    if (!paused) {
      resetFrameFlags();
      this.layout.resetFrameState();

      const ctx: EffectCtx = {
        g,
        time,
        dt,
        audio: audioFrame,
        rng: this.scheduler.phaseRng,
        params: this.params,
        layout: this.layoutHandle,
        log: (text) => this.transport.send({ type: 'log', text }),
      };

      this.scheduler.update(ctx);
      this.layout.update(g, time, dt);

      const boxes = this.layout.boxes;
      for (const box of boxes) {
        resetStyle(box.style);
        box.intensityOffset = 0;
      }

      // Background first so compositing effects paint over it, under text.
      g.background(this.params.num('master/bgGray'));

      // Effect pipeline, registry order.
      for (const effect of EFFECTS) {
        const intensity = this.scheduler.intensityOf(effect.id);
        if (intensity <= 0.001) {
          if (effect.wantsSolo) effect.soloActive = false;
          continue;
        }
        if (effect.kind === 'global') {
          effect.update(boxes, intensity, ctx);
        } else {
          for (const box of boxes) {
            const eff = clamp01(intensity + box.intensityOffset);
            if (eff > 0.001) effect.apply(box, box.style, eff, ctx);
          }
        }
      }

      for (const box of boxes) this.drawBox(box);
    }

    // Post pass (or direct blit if post failed to init).
    if (this.post) {
      const p = (key: string) =>
        clamp01(Math.max(this.params.num(`post/${key}`), this.scheduler.postDriveOf(key)));
      const enabled = this.params.bool('post/enabled');
      this.post.render(this.g.elt as HTMLCanvasElement, time, {
        rgbSplit: enabled ? p('rgbSplit') : 0,
        feedbackDecay: enabled ? Math.min(0.97, p('feedbackDecay')) : 0,
        displacement: enabled ? p('displacement') * (0.4 + 0.6 * audioFrame.energy) : 0,
        scanlines: enabled ? p('scanlines') : 0,
        noise: enabled ? p('noise') : 0,
        bloomish: enabled ? p('bloomish') : 0,
        invert: enabled ? frameFlags.invert : 0,
        brightness: this.params.num('master/brightness'),
      });
    }

    this.trackFps(time);
  }

  // ---- box drawing ----

  private drawBox(box: TextBox): void {
    const layout = box.layout;
    if (!layout) return;
    const g = this.g;
    const style = box.style;
    const rect = box.rect;
    const pad = this.params.num('layout/padding');
    const innerW = rect.w - pad * 2;
    const innerH = rect.h - pad * 2;
    const boxAlpha = style.opacity * (1 - style.dim);
    if (boxAlpha <= 0.004) return;

    const ctx2d = g.drawingContext as CanvasRenderingContext2D;
    g.push();

    // Whole-box background fill.
    if (style.boxFill && style.boxOpacity > 0.01) {
      ctx2d.globalAlpha = style.boxOpacity * (1 - style.dim);
      g.noStroke();
      g.fill(style.boxFill);
      g.rect(rect.x, rect.y, rect.w, rect.h);
    }

    // sizeScale shrinks around the rect center — fitted size is the ceiling.
    if (style.sizeScale < 0.999) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      g.translate(cx, cy);
      g.scale(Math.min(1, style.sizeScale));
      g.translate(-cx, -cy);
    }

    const vSpace = innerH - layout.totalHeight;
    const vOff = style.vJustify === 'top' ? 0 : style.vJustify === 'center' ? vSpace / 2 : vSpace;
    const originX = rect.x + pad;
    const originY = rect.y + pad + vOff;

    g.textSize(layout.fontSize);
    g.textAlign('left' as never, 'baseline' as never);
    g.noStroke();

    // Ghost passes: whole text redrawn offset + translucent, no word details.
    for (const ghost of style.ghosts) {
      ctx2d.globalAlpha = boxAlpha * ghost.alpha;
      g.fill(style.fill);
      this.drawTextPass(box, originX + ghost.dx, originY + ghost.dy, innerW, true);
    }

    ctx2d.globalAlpha = boxAlpha;
    this.drawTextPass(box, originX, originY, innerW, false);

    g.pop();
    ctx2d.globalAlpha = 1;
  }

  private drawTextPass(
    box: TextBox,
    originX: number,
    originY: number,
    innerW: number,
    ghostPass: boolean,
  ): void {
    const g = this.g;
    const style = box.style;
    const layout = box.layout!;
    const ctx2d = g.drawingContext as CanvasRenderingContext2D;
    const baseAlpha = ctx2d.globalAlpha;
    const visible = style.visibleChars;

    for (const line of layout.lines) {
      // Clamp tracking so the line never escapes the rect.
      const lineChars = line.words.reduce((n, w) => n + w.text.length, 0) + line.words.length - 1;
      let spacing = style.letterSpacing * layout.fontSize;
      if (spacing > 0 && lineChars > 1) {
        spacing = Math.min(spacing, (innerW - line.width) / (lineChars - 1));
      }
      spacing = Math.max(spacing, -0.05 * layout.fontSize);
      const useSpacing = Math.abs(spacing) > 0.01;

      const effLineWidth = line.width + (useSpacing ? spacing * (lineChars - 1) : 0);
      const slack = innerW - effLineWidth;
      const xOff =
        style.justify === 'left' ? 0 : style.justify === 'center' ? slack / 2 : slack;

      let charsBefore = 0; // chars (incl. spaces) preceding current word in this line
      for (const word of line.words) {
        const override = ghostPass ? undefined : style.perWord.get(word.wordIndex);
        const wordLen = word.text.length;

        if (override?.hidden) {
          charsBefore += wordLen + 1;
          continue;
        }
        // Typewriter cut.
        let drawText = word.text;
        if (visible >= 0) {
          if (word.charStart >= visible) break;
          if (word.charStart + wordLen > visible) {
            drawText = word.text.slice(0, visible - word.charStart);
          }
        }
        if (override?.upper) drawText = drawText.toUpperCase();

        const wx = originX + word.x + xOff + (useSpacing ? charsBefore * spacing : 0);
        const wy = originY + line.y;

        // Word background rect (behind the full word).
        if (!ghostPass && override?.boxFill) {
          g.fill(override.boxFill);
          g.rect(
            wx - 3,
            wy - layout.ascent - 2,
            word.w + (useSpacing ? spacing * wordLen : 0) + 6,
            layout.fontSize * 1.18,
          );
        }

        g.fill(override?.fill ?? style.fill);
        if (override?.scale && override.scale !== 1) g.textSize(layout.fontSize * override.scale);

        // Per-char path only when an effect requires it.
        const hasCharOverride =
          !ghostPass &&
          style.charOverrides.size > 0 &&
          rangeHasOverride(style.charOverrides, word.charStart, word.charStart + wordLen);

        if (useSpacing || hasCharOverride) {
          let cx = wx;
          for (let i = 0; i < drawText.length; i++) {
            const ch = ghostPass
              ? drawText[i]
              : style.charOverrides.get(word.charStart + i) ?? drawText[i];
            g.text(ch, cx, wy);
            cx += g.textWidth(drawText[i]) + (useSpacing ? spacing : 0);
          }
        } else {
          g.text(drawText, wx, wy);
        }

        if (override?.scale && override.scale !== 1) g.textSize(layout.fontSize);
        charsBefore += wordLen + 1;
      }
      ctx2d.globalAlpha = baseAlpha;
    }
  }

  // ---- status / fps ----

  private trackFps(time: number): void {
    this.fpsFrames++;
    if (time - this.fpsWindowStart >= 1) {
      this.fps = this.fpsFrames / (time - this.fpsWindowStart);
      this.fpsFrames = 0;
      this.fpsWindowStart = time;
    }
    // 4Hz so the control-panel meter is usable for tuning; fps value itself
    // still integrates over 1s windows.
    if (time - this.lastStatusAt >= 0.25) {
      this.lastStatusAt = time;
      this.transport.send({
        type: 'status',
        payload: {
          fps: Math.round(this.fps),
          phase: this.scheduler.phaseName,
          effects: this.scheduler.activeEffects(),
          beat: this.beatSinceStatus,
          bpm: Math.round(this.clock.bpm * 10) / 10,
          boxCount: this.layout.boxes.length,
          audioStatus: this.audio.status,
          bands: this.lastAudio.bands,
          energy: this.lastAudio.energy,
        },
      });
      this.beatSinceStatus = false;
    }
  }
}

function rangeHasOverride(map: Map<number, string>, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (map.has(i)) return true;
  return false;
}
