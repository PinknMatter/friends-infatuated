// Render window entry. Owns the authoritative param store, the p5 2D text
// layer, and the WebGL2 post pass. Fullscreen with 'f'; audio starts on first
// interaction (browser gesture requirement).

import p5 from 'p5';
import { ParamStore, PARAM_DEFS } from './core/params';
import { BroadcastTransport } from './core/transport';
import { attachOscBridge } from './core/wsTransport';
import { Clock } from './core/clock';
import { resolveFont } from './core/fonts';
import { StaticSentenceStore } from './data/sentences';
import { startSupabaseSync } from './data/supabaseSync';
import { SUBMIT_URL } from './data/supabaseConfig';
import { LayoutEngine } from './layout/layoutEngine';
import { clearFitCache } from './layout/fitText';
import { AudioAnalyser } from './audio/analyser';
import { PhaseScheduler } from './phases/scheduler';
import { Renderer } from './render/renderer';
import { PostPass } from './render/post/post';

const W = 1920;
const H = 1080;

const params = new ParamStore(PARAM_DEFS);
// Render window only: mirror onto the OSC bridge WS (silent no-op when the
// bridge isn't running). The panel keeps plain BroadcastChannel.
const transport = attachOscBridge(new BroadcastTransport());
params.bindTransport(transport, 'render');

const clock = new Clock(params);
const store = new StaticSentenceStore();
params.onChange('data/injectRandom', () => store.injectRandom());
// Optional dataset drop-in: /public/sentences.json (array of strings).
void store.loadExternal().then((n) => {
  if (n > 0) {
    console.info(`[data] merged ${n} external sentences`);
    transport.send({ type: 'log', text: `dataset: merged ${n} sentences from sentences.json` });
  }
});
// Audience submissions (QR-code site → Supabase → here). No-op when
// supabaseConfig is empty.
startSupabaseSync(store, (text) => transport.send({ type: 'log', text }));

const layout = new LayoutEngine(params, store, W, H, (text) =>
  transport.send({ type: 'log', text }),
);
const audio = new AudioAnalyser(params, clock);
const scheduler = new PhaseScheduler(params, clock);

// Audio file uploaded from the control panel → play + analyse here.
transport.onMessage((msg) => {
  if (msg.type !== 'audio-file') return;
  audio
    .playFile(msg.buffer, msg.name)
    .then(() => transport.send({ type: 'log', text: `audio file playing: ${msg.name}` }))
    .catch(() =>
      transport.send({
        type: 'log',
        text: 'audio file failed — click the render window once, then re-upload',
      }),
    );
});

params.onChange('master/seed', () => layout.requestReshuffle());

// ---- QR screen: DOM overlay (above the canvas, so the post shader can never
// distort the code into unscannability) that reads as a PHASE, not a slide:
// the engine keeps running visibly behind a scrim, the headline types itself
// in and out in a lifecycle-style loop, the QR frame breathes. Built once,
// shown on master/qrShow.
const QR_HEADLINE = 'KEEP YOUR FRIENDS CLOSE';
const QR_TYPE_MS = 55; // per char, ≈ the engine's type-in feel

function buildQrOverlay(): { overlay: HTMLDivElement; headText: HTMLSpanElement } {
  const style = document.createElement('style');
  style.textContent = [
    '@keyframes qr-breathe { 0%,100% { transform:scale(1); } 50% { transform:scale(1.035); } }',
    '@keyframes qr-cursor { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }',
    // rare soft dips, like flashInOut grazing the headline (gentle, not a strobe)
    '@keyframes qr-flicker { 0%,91%,95%,100% { opacity:1; } 92%,94% { opacity:0.3; } }',
  ].join('\n');
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'qr-overlay';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:50',
    'display:none',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:36px',
    'background:rgba(0,0,0,0.45)', // scrim — the phases stay visible behind
    "font-family:'Space Grotesk',monospace",
    'color:#fff',
    'text-align:center',
    'cursor:none',
    'pointer-events:none',
  ].join(';');

  const heading = document.createElement('div');
  heading.style.cssText =
    'font-size:56px;letter-spacing:0.12em;font-weight:700;max-width:88vw;' +
    'min-height:1.2em;animation:qr-flicker 9s linear infinite;' +
    'text-shadow:0 0 24px rgba(0,0,0,0.9)';
  const headText = document.createElement('span');
  const cursor = document.createElement('span');
  cursor.textContent = '_';
  cursor.style.cssText = 'animation:qr-cursor 1s steps(1) infinite';
  heading.append(headText, cursor);

  const frame = document.createElement('div');
  frame.style.cssText =
    'background:#fff;padding:28px;line-height:0;' +
    'animation:qr-breathe 4s ease-in-out infinite;box-shadow:0 0 60px rgba(0,0,0,0.8)';
  const img = document.createElement('img');
  img.src = '/qr.png';
  img.alt = SUBMIT_URL;
  img.style.cssText = 'width:min(38vh,420px);height:auto;image-rendering:pixelated';
  frame.appendChild(img);

  const sub = document.createElement('div');
  sub.textContent = 'scan · write · it lands on the wall';
  sub.style.cssText =
    'font-size:24px;letter-spacing:0.1em;color:#ccc;text-shadow:0 0 16px rgba(0,0,0,0.9)';

  const url = document.createElement('div');
  url.textContent = SUBMIT_URL.replace(/^https?:\/\//, '');
  url.style.cssText =
    'font-size:28px;letter-spacing:0.06em;color:#e8e8e8;text-shadow:0 0 16px rgba(0,0,0,0.9)';

  overlay.append(heading, frame, sub, url);
  document.body.appendChild(overlay);
  return { overlay, headText };
}

const qr = buildQrOverlay();
let qrTypeTimer: number | null = null;

// Lifecycle-style headline loop: type in → hold → backspace → brief empty →
// again. Runs only while the overlay is visible.
function startQrTyping(): void {
  let chars = 0;
  let dir = 1;
  let hold = 0;
  qr.headText.textContent = '';
  qrTypeTimer = window.setInterval(() => {
    if (hold > 0) {
      hold--;
      return;
    }
    chars += dir === 1 ? 1 : -2; // backspace at ~2× like the engine's type-out
    if (chars >= QR_HEADLINE.length) {
      chars = QR_HEADLINE.length;
      dir = -1;
      hold = Math.round(3500 / QR_TYPE_MS);
    } else if (chars <= 0) {
      chars = 0;
      dir = 1;
      hold = Math.round(700 / QR_TYPE_MS);
    }
    qr.headText.textContent = QR_HEADLINE.slice(0, chars);
  }, QR_TYPE_MS);
}

params.onChange('master/qrShow', (v) => {
  qr.overlay.style.display = v ? 'flex' : 'none';
  if (qrTypeTimer !== null) {
    window.clearInterval(qrTypeTimer);
    qrTypeTimer = null;
  }
  if (v) startQrTyping();
});

new p5((p: p5) => {
  let g: p5.Graphics;
  let renderer: Renderer;
  let post: PostPass | null = null;
  let lastTime = 0;
  let audioStarted = false;

  p.setup = () => {
    const main = p.createCanvas(1, 1);
    (main.elt as HTMLCanvasElement).style.display = 'none';

    g = p.createGraphics(W, H);
    (g.elt as HTMLCanvasElement).style.display = 'none';
    g.textFont(resolveFont(params.str('master/fontId')).family);
    g.pixelDensity(1);

    try {
      post = new PostPass(W, H);
      post.canvas.id = 'output';
      document.getElementById('stage')!.appendChild(post.canvas);
    } catch (err) {
      // No WebGL2: show the raw 2D layer instead of dying.
      console.warn('[post] disabled:', err);
      (g.elt as HTMLCanvasElement).style.display = '';
      (g.elt as HTMLCanvasElement).id = 'output';
      document.getElementById('stage')!.appendChild(g.elt as HTMLCanvasElement);
    }

    renderer = new Renderer({ g, params, clock, layout, scheduler, audio, transport, post });

    // Fonts load async — force the load, then refit everything so text is
    // measured with the real face, not a fallback.
    const family = resolveFont(params.str('master/fontId')).family;
    document.fonts
      ?.load(`32px '${family}'`)
      .then(() => {
        clearFitCache();
        for (const box of layout.boxes) box.layout = null;
      })
      .catch(() => {});

    const startAudio = () => {
      if (audioStarted) return;
      audioStarted = true;
      document.getElementById('hint')?.remove();
      void audio.start();
    };
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', (e) => {
      startAudio();
      if (e.key === 'f') void document.documentElement.requestFullscreen().catch(() => {});
    });
  };

  p.draw = () => {
    const time = p.millis() / 1000;
    const dt = Math.min(0.1, time - lastTime || 0.016);
    lastTime = time;
    renderer.frame(time, dt);
  };
});
