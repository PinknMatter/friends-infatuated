# FRIENDS INFATUATED — Typographic VJ Engine

Audience-submitted sentences about friends, laid out in a non-overlapping BSP
grid and animated through ~20 audio-reactive text effects. Stage 1: visuals +
control UI (no Supabase, no OSC — but both have seams ready).

## Run

```
npm install
npm run dev
```

- `http://localhost:5173/` — render window (1920×1080). Click once to start
  audio (browser gesture rule), `F` for fullscreen.
- `http://localhost:5173/control.html` — control panel. Auto-generated from the
  param registry; open it on the laptop screen next to the projector output.

## Smoke test

With the dev server running:

```
node scripts/smoke.mjs
```

Drives both pages headless in system Chrome, checks the transport round-trip,
and captures screenshots (`SMOKE_SHOT_DIR` to redirect).

## Architecture notes

- **`src/core/params.ts`** is the single source of truth for every tunable.
  All runtime mutation flows through `params.set` / `params.trigger` — the
  control panel, the phase scheduler, and (later) the OSC bridge are all just
  clients. OSC addresses will derive from param paths.
- **`src/core/transport.ts`** — `Transport` interface; BroadcastChannel today,
  WebSocket for the OSC bridge later without touching consumers.
- **`src/layout/`** owns box rects exclusively. Effects get `Readonly<Rect>`
  and mutate a per-frame `BoxStyle` instead. `perturbRatios`-style breathing
  goes through `LayoutEngine.setBreathe`.
- **`src/effects/registry.ts`** lists effects in composition order and the
  chaos-dependent selection weights the phase scheduler uses.
- **`src/phases/scheduler.ts`** — phases of 2–4 effects crossfaded over beats;
  the `phases/chaos` param is the fader you ride all night. Per-effect
  intensity overrides (`fx/<id>/intensity`, −1 = scheduler) win until cleared.
- **`src/render/post/`** — raw WebGL2 single-pass chain: rgb split, feedback
  trails (ping-pong), displacement, scanlines, grain, bloom-ish, strobe invert
  (hard-capped ≤ 4 flashes/sec for photosensitivity).
- **`src/data/sentences.ts`** — `SentenceStore` interface (~230 sentences
  built in); Supabase later. `data/injectRandom` simulates sentences arriving
  during the night. **Dataset drop-in**: put a JSON array of strings at
  `public/sentences.json` and it merges at startup (deduped, 3–24 words).
- **Layout shifts**: two kinds. *Grid morphs* (`layout/morph`) glide every
  split ratio to a new value so the whole grid reflows as one unit — boxes
  keep their slots and sentences. *Full reshuffles* (`layout/reshuffle`)
  rebuild the tree with fresh sentences. The layoutReshuffle effect fires
  morphs most of the time (`fx/layoutReshuffle/fullProb` controls the mix).
  `layout/rowBias` squeezes the layout into stacked rows (1 = all rows,
  0 = aspect-based grid).
- **Manual BPM is a hard override**: when `audio/useManualBpm` is on, beat
  detection neither sets the tempo nor re-anchors the beat grid.
- Fonts: every box carries a `fontId` resolved via `src/core/fonts.ts` (one
  entry today). NOTE: p5 quote-wraps the whole `textFont` string, so entries
  must be a single family name, not a CSS stack.
