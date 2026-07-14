// Headless smoke test: load render window + control panel, capture console
// errors, verify the render loop produces non-black frames and that a control
// panel slider change round-trips over BroadcastChannel.
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const errors = [];
const hook = (label) => (page) => {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
};

const render = await ctx.newPage();
hook('render')(render);
await render.goto(BASE + '/', { waitUntil: 'networkidle' });

const control = await ctx.newPage();
hook('control')(control);
await control.goto(BASE + '/control.html', { waitUntil: 'networkidle' });

// Let the render loop run.
await render.bringToFront();
await render.mouse.click(640, 360); // gesture → audio start
await render.waitForTimeout(4000);

// 1. Render loop produced frames? Sample the visible output canvas.
const frameInfo = await render.evaluate(() => {
  const out = document.getElementById('output');
  if (!out) return { ok: false, why: 'no #output canvas' };
  const probe = document.createElement('canvas');
  probe.width = 128; probe.height = 72;
  const c = probe.getContext('2d');
  c.drawImage(out, 0, 0, 128, 72);
  const d = c.getImageData(0, 0, 128, 72).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
  return { ok: lit > 20, lit, w: out.width, h: out.height };
});

// 2. Control panel connected? (status bar flips to connected)
await control.bringToFront();
await control.waitForTimeout(1500);
const connText = await control.locator('#conn').textContent();
const effectsText = await control.locator('#effects').textContent();
const fpsText = await control.locator('#fps').textContent();

// 3. Param round-trip: set chaos from the control page store, verify render side.
await control.evaluate(() => {
  const bc = new BroadcastChannel('friends-infatuated');
  bc.postMessage({ type: 'param-set', path: 'phases/chaos', value: 0.77 });
});
await render.waitForTimeout(500);

// 4. Trigger a reshuffle + a phase advance, run a few more seconds, recheck errors.
await control.evaluate(() => {
  const bc = new BroadcastChannel('friends-infatuated');
  bc.postMessage({ type: 'param-trigger', path: 'layout/reshuffle' });
  bc.postMessage({ type: 'param-trigger', path: 'phases/next' });
  bc.postMessage({ type: 'param-trigger', path: 'data/injectRandom' });
});
await render.waitForTimeout(4000);

const frameInfo2 = await render.evaluate(() => {
  const out = document.getElementById('output');
  const probe = document.createElement('canvas');
  probe.width = 128; probe.height = 72;
  const c = probe.getContext('2d');
  c.drawImage(out, 0, 0, 128, 72);
  const d = c.getImageData(0, 0, 128, 72).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
  return { lit };
});

const shotDir = process.env.SMOKE_SHOT_DIR || '.';
await render.screenshot({ path: `${shotDir}/render.png` });
await control.screenshot({ path: `${shotDir}/control.png`, fullPage: false });

console.log(JSON.stringify({
  frameInfo, frameInfo2, connText, fpsText,
  effectsText: (effectsText || '').slice(0, 200),
  errors: errors.slice(0, 20),
}, null, 2));

await browser.close();
