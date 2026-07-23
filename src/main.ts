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

const layout = new LayoutEngine(params, store, W, H);
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
