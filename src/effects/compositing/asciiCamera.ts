// Webcam → luminance-sampled ASCII grid. In sentence mode (default) the
// glyphs ARE the visible sentences: the box text fades out and its characters
// flow in reading order through the lit cells, so the crowd's image is
// literally written with the crowd's words. Ramp-glyph mode is the fallback.
// Self-disables gracefully if camera permission is denied.

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const RAMP = ' .:-=+*#%@';
const SAMPLE_W = 160; // downsample resolution for luminance reads
const SAMPLE_H = 90;

let video: HTMLVideoElement | null = null;
let sampler: CanvasRenderingContext2D | null = null;
let state: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';

async function startCamera(ctx: EffectCtx): Promise<void> {
  state = 'starting';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 360 },
    });
    video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    sampler = canvas.getContext('2d', { willReadFrequently: true });
    state = 'ready';
    ctx.log('asciiCamera: camera ready');
  } catch (err) {
    state = 'failed';
    ctx.log(`asciiCamera: disabled (${err instanceof Error ? err.name : 'error'})`);
  }
}

export const asciiCamera: GlobalEffect = {
  id: 'asciiCamera',
  kind: 'global',

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    if (intensity <= 0.02 || state === 'failed') return;
    if (state === 'idle') {
      void startCamera(ctx);
      return;
    }
    if (state !== 'ready' || !video || !sampler) return;

    const cellSize = ctx.params.num('fx/asciiCamera/cellSize');
    const tint = ctx.params.str('fx/asciiCamera/tint');
    const useSentences = ctx.params.bool('fx/asciiCamera/useSentences');
    const threshold = ctx.params.num('fx/asciiCamera/threshold');
    const g = ctx.g;
    const cols = Math.ceil(g.width / cellSize);
    const rows = Math.ceil(g.height / cellSize);

    // Sentence stream: all visible sentences in reading order, looped. A slow
    // scroll makes the words flow through the image over time.
    let stream = '';
    let streamPos = 0;
    if (useSentences) {
      stream = boxes.map((b) => b.sentence).join('  ·  ');
      if (stream.length === 0) stream = RAMP;
      const flowSpeed = ctx.params.num('fx/asciiCamera/flowSpeed');
      streamPos = Math.floor(ctx.time * flowSpeed) % stream.length;

      // The text becomes the ascii: fade the boxes out as intensity rises.
      const fade = ctx.params.num('fx/asciiCamera/fadeText');
      for (const box of boxes) {
        box.style.dim = Math.max(box.style.dim, fade * intensity);
      }
    }

    sampler.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const pixels = sampler.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

    g.push();
    g.textAlign('center' as never, 'center' as never);
    g.textSize(cellSize * 0.95);
    g.noStroke();
    const ctx2d = g.drawingContext as CanvasRenderingContext2D;
    g.fill(tint);
    for (let cy = 0; cy < rows; cy++) {
      const sy = Math.min(SAMPLE_H - 1, Math.floor((cy / rows) * SAMPLE_H));
      for (let cx = 0; cx < cols; cx++) {
        // Mirror horizontally so the crowd reads it like a mirror.
        const sx = Math.min(SAMPLE_W - 1, SAMPLE_W - 1 - Math.floor((cx / cols) * SAMPLE_W));
        const i = (sy * SAMPLE_W + sx) * 4;
        const lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;

        if (useSentences) {
          if (lum < threshold) continue; // dark cells stay empty
          // Consume the stream only on lit cells so sentences snake
          // contiguously through the bright parts of the image.
          const ch = stream[streamPos];
          streamPos = (streamPos + 1) % stream.length;
          if (ch === ' ') continue;
          ctx2d.globalAlpha = intensity * (0.2 + 0.8 * lum);
          g.text(ch, cx * cellSize + cellSize / 2, cy * cellSize + cellSize / 2);
        } else {
          const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
          if (ch === ' ') continue;
          ctx2d.globalAlpha = intensity * 0.78;
          g.text(ch, cx * cellSize + cellSize / 2, cy * cellSize + cellSize / 2);
        }
      }
    }
    ctx2d.globalAlpha = 1;
    g.pop();
  },
};
