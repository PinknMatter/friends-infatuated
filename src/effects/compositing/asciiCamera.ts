// Webcam → luminance-sampled ASCII grid drawn as a background layer behind
// the text boxes. Self-disables gracefully if camera permission is denied.

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
    const g = ctx.g;
    const cols = Math.ceil(g.width / cellSize);
    const rows = Math.ceil(g.height / cellSize);

    sampler.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const pixels = sampler.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

    g.push();
    g.textAlign('center' as never, 'center' as never);
    g.textSize(cellSize * 0.95);
    g.noStroke();
    const alpha = Math.floor(200 * intensity);
    g.fill(tint + alpha.toString(16).padStart(2, '0'));
    for (let cy = 0; cy < rows; cy++) {
      const sy = Math.min(SAMPLE_H - 1, Math.floor((cy / rows) * SAMPLE_H));
      for (let cx = 0; cx < cols; cx++) {
        // Mirror horizontally so the crowd reads it like a mirror.
        const sx = Math.min(SAMPLE_W - 1, SAMPLE_W - 1 - Math.floor((cx / cols) * SAMPLE_W));
        const i = (sy * SAMPLE_W + sx) * 4;
        const lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
        if (ch !== ' ') {
          g.text(ch, cx * cellSize + cellSize / 2, cy * cellSize + cellSize / 2);
        }
      }
    }
    g.pop();
  },
};
