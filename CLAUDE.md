# FRIENDS INFATUATED — System Documentation (for AI assistants)

A generative typographic VJ engine for a rave. Audience-submitted sentences
about friends are laid out in a non-overlapping BSP grid at 1920×1080 and
animated through ~16 audio-reactive text effects, composed generatively in
"phases" that evolve over the night. Runs fullscreen in a browser, HDMI to a
projector, controlled from a second browser tab. Stage 2 added the Supabase
submission pipeline; stage 3 added the OSC bridge (TouchOSC), DB sentence mix,
flash spawn style, QR screen, blackout, and NDI docs (see those sections).

## Commands

```
npm run dev          # Vite dev server: / = render window, /control.html = panel
npm run build        # tsc --noEmit && vite build
npm run typecheck    # tsc --noEmit
npm run test:audio   # REAL analyser+clock driven at simulated 60fps with
                     # synthetic compressed 174 BPM jungle; prints detection
                     # rate, tempo estimate, band movement at gain 1.0 & 0.05
node scripts/smoke.mjs   # headless E2E (needs dev server running): loads both
                         # pages, checks transport round-trip, screenshots.
                         # SMOKE_SHOT_DIR env redirects screenshot output.
npm run osc          # OSC bridge: UDP OSC :9000 -> WebSocket :8765 (docs/OSC.md)
```

Stack: Vite + vanilla TypeScript, p5.js (instance mode, 2D renderer only) for
the text layer, raw WebGL2 for post-processing, raw Web Audio (NO p5.sound).
No framework anywhere. Two Vite entry points share one codebase.

## Verification caveats (headless testing)

- Headless Chrome + SwiftShader runs ~1–5 fps. Anything frame-rate-sensitive
  (beat detection especially) CANNOT be validated in headless browser tests —
  use `npm run test:audio`, which drives the real analyser code at a simulated
  60fps in Node (esbuild-bundled, fake AnalyserNode injected).
- The visible output is a WebGL canvas without `preserveDrawingBuffer`;
  `drawImage`/pixel probes outside its own rAF read BLACK. Use Playwright
  screenshots instead.
- Playwright smoke tests use system Chrome via `playwright-core`
  (executablePath `C:/Program Files/Google/Chrome/Application/chrome.exe`)
  with fake media-device flags.

## Architecture: one frame

```
p5.draw @60fps (src/main.ts → src/render/renderer.ts Renderer.frame)
 1. clock.update(time)                 — beat grid position, beatThisFrame
 2. audio.update(time, dt)            — FFT → bands (auto-gained), flux beat
    → AudioFrame {bands, beat, beatPos, bpm, energy, drive}
 3. renderer computes audioFrame.drive — bpm/120 × slow-smoothed energy
 4. scheduler.update(ctx)             — phase crossfades, effect intensities,
                                        scene switching, post drive
 5. layout.update(g, time, dt, drive) — lifecycles, reshuffle/morph, rect
                                        tweens, fitText refits
 6. reset per-box BoxStyle + intensityOffset
 7. g.background(bgGray)
 8. EFFECTS in registry order: global.update(boxes,…) / box.apply(box,…)
    (box-effect intensity = clamp01(schedIntensity + box.intensityOffset))
 9. drawBox() per box — pure consumer of BoxStyle + cached TextLayout
10. beat-monitor HUD (if audio/beatMonitor)
11. post.render(g.elt canvas, uniforms)  — WebGL2 pass → visible canvas
12. status broadcast at 20Hz over the Transport
```

## src/core/params.ts — THE param registry (read this first)

Single source of truth for EVERYTHING tunable. ~130 params. The control panel
auto-generates from `PARAM_DEFS`; OSC addresses will later derive from paths.
**Rule: no magic numbers in effect/renderer code — anything worth tweaking
live is a param.**

- Types: `float | int | bool | enum | trigger`. Paths like `phases/chaos`,
  `fx/typewriter/speed`. Group string = control-panel section.
- `ParamStore`: `get/num/bool/str(path)`, `set(path, value)`,
  `trigger(path)`, `onChange(path, cb)`, `serialize/deserialize` (presets,
  triggers excluded). Triggers store an incrementing fire-counter so
  `onChange` fires every time.
- `bindTransport(transport, 'render' | 'control')`: every set/trigger
  broadcasts; the render window is authoritative and answers `sync-request`
  with full state. Both windows hold mirrored stores.
- Convention: `fx/<id>/intensity` = −1 means "auto" (scheduler drives);
  0..1 is a manual override that wins until reset to −1.
  `fx/<id>/enabled` (generated for all `FX_IDS` at the bottom of the file) is
  a hard kill that beats both scheduler AND override.
- `audio/deviceId` is an enum whose options are extended at runtime by the
  control panel after `enumerateDevices` — the registry only has 'default'.

## src/core/transport.ts

`Transport` interface (send/onMessage/close) + `BroadcastTransport`
(BroadcastChannel 'friends-infatuated'). Message types: `param-set`,
`param-trigger`, `sync-request`, `sync-state`, `status` (20Hz, includes fps,
phase+scene name, active effects, beat/detected flags, detection monitor
values, bpm + mode + detected tempo + confidence, drive, bands, audio status),
`log` (surfaces in the panel's log footer), `audio-file` (name + ArrayBuffer,
structured-cloned control→render).

**OSC bridge (LIVE)**: `scripts/osc-bridge.mjs` (`npm run osc`) listens for UDP
OSC on :9000, serves WebSocket on :8765. `/param/<path> <arg>` → `param-set`;
`/trigger/<path>` → `param-trigger` (arg 0 = TouchOSC button release, ignored).
Hand-rolled OSC parser (f/i/s/T/F + bundles), no OSC dep; `ws` devDependency.
`src/core/wsTransport.ts` `attachOscBridge(base)` wraps the render window's
BroadcastTransport (render only — it is authoritative): messages received on
either leg are delivered AND relayed to the other (never echoed back onto the
arrival leg) so the panel stays truthful; `audio-file` never crosses the WS;
silent 2s reconnect forever — bridge down = zero behavior change (browser-native
WS console warnings are expected and harmless). TouchOSC address map +
examples: docs/OSC.md. NDI output is external capture (OBS/DistroAV or NDI
Screen Capture) — setup + show-night checklist: docs/NDI.md.

## src/core/clock.ts — beat/bar clock, TWO STRICT MODES

- **Manual** (`audio/useManualBpm` = true, default): metronome grid at
  `audio/manualBpm`; detection is COMPLETELY ignored (no tempo feed, no grid
  re-anchor). `beatThisFrame` = grid crossings. Tap tempo sets manualBpm.
- **Auto** (false): manual param is entirely out of the loop. `beatThisFrame`
  fires ONLY on actually-detected beats (silence = no beats). Tempo comes
  from the estimator; neutral 120 until it locks. Every detected beat
  re-anchors the grid PHASE while **preserving the accumulated beat count**
  (`phaseOrigin = time − round(beatPosition) × beatDuration`) — naive
  re-anchoring froze bar progression and with it the phase scheduler.
- Tempo estimator (runs in BOTH modes so the panel can display it):
  inter-beat intervals octave-folded into 70–180 BPM, clustered with 30ms
  tolerance; modal cluster mean → `detectedBpm`, cluster fraction →
  confidence (accepted at ≥0.4). Exposed via `detectedTempo`.
- `beatPosition` (float, continuous) is THE sync signal for rhythmic effects
  (via `AudioFrame.beatPos`). `barPosition` = beatPosition/4.

## src/audio/analyser.ts — Web Audio analysis

Graph: source → gain → AnalyserNode(FFT 2048, smoothing 0 — we smooth
ourselves). GainNode NEVER connects to destination (mic feedback). Two
sources, identical analysis path:
- Live input (mic/line-in, `audio/deviceId`), started on first user gesture.
- Uploaded file (`playFile`): decoded, looped (`audio/fileLoop`), also routed
  to speakers via a separate monitor gain (`audio/fileVolume`);
  `audio/fileStop` trigger → back to live input. Non-looping end → auto
  fallback to live.

Bands: low/mid/high split at `audio/lowCross`/`midCross`, per-band makeup
boosts (`lowBoost/midBoost/highBoost` — spectra tilt bass-heavy), then
**auto-gain** (`audio/autoGain`): each band normalized into its own rolling
floor..peak range (peak: instant up, ~8s decay; floor: ~10s rise, **capped at
55% of peak** so compressed pinned-loud music reads ~1 instead of collapsing
the range to zero). CRITICAL: boosts must NOT clamp to 1 before auto-gain —
saturation flattens the band to a constant. Then attack/release smoothing.
Effects therefore see the music's relative MOVEMENT at any absolute level.

Beat detection: **spectral flux** — positive frame-to-frame spectral change,
20Hz–4kHz, low bins ×3 weight, divided by current spectral energy. Input gain
cancels out entirely; sustained bass contributes no flux. Threshold =
rolling-average flux × `audio/beatSensitivity` + 0.01, refractory 250ms.
`monitor {rawLow: flux, avg, threshold}` feeds the beat monitors, which draw
flux RELATIVE to threshold (red tick fixed at 40% of the bar).

## AudioFrame.drive (computed in renderer.ts)

`drive = 1 + (clamp(bpm/120 × (0.45 + 1.35 × slowEnergy), 0.3, 3) − 1) ×
audio/driveAmount`, slowEnergy = 2.5s-smoothed energy (follows sections, not
hits). Fast loud music → drive ~2+: shorter sentence lifetimes, tighter spawn
stagger, faster type in/out, more frequent reshuffles/morphs
(layoutReshuffle effect divides its interval by drive), shorter scene dwells
(scheduler divides sceneMinBars by drive). Breakdowns → drive <1, everything
slows. Shown in the panel as `motion ×N`.

## src/layout/ — BSP layout + sentence lifecycle

**INVARIANT: only the layout engine ever mutates box rects.** Effects receive
`Readonly<Rect>` and mutate the per-frame `BoxStyle` instead.

- `bsp.ts`: recursive splits; direction = aspect-weighted, then
  `layout/rowBias` suppresses vertical cuts (0.75 default → stacked-rows
  look; 0 = grid, 1 = all rows). Split ratios live on nodes:
  - `computeLeafRects(root, region, breathe)` — breathe wobbles each ratio
    with a per-node sine (gridBreathe primitive).
  - `retargetRatios` + `applyMorphT` — **grid morph**: every ratio glides to
    a new target so the whole grid reflows AS ONE UNIT; boxes keep slots,
    sentences, neighbours.
- `layoutEngine.ts`:
  - Reshuffle (full rebuild): new tree, sentences paired longest→largest
    box, old boxes matched to new slots by nearest-center for tweened
    transitions (eased, `layout/transitionDur`). Morph (`layout/morph`
    trigger / `requestMorph()`): ratio glide over `layout/morphDur`.
  - Refits text via fitText only when a box's inner size moved >3px; caches
    make mid-tween refits cheap.
  - **Sentence lifecycle** (`layout/lifecycle`, the "always moving" core):
    each box types in (`typeInSpeed`), lives `rng(lifeMin..lifeMax)/drive`
    seconds, types out backspace-style (`typeOutSpeed`), respawns with the
    next pool sentence (staggered). **Flash mode** (`layout/spawnStyle` =
    'flash', rerolled per phase by the scheduler with `phases/flashProb`,
    gated on `phases/enabled`): sentence appears WHOLE with a 0.3s all/none
    blink (60ms period), lives, then cuts instantly — no typewriter either
    way; the 'type' path is untouched (early branch). `box.lifeVisible` = chars visible
    (−1 = all); renderer min()s it with effect-driven `style.visibleChars`.
    Boxes with lifeVisible 0 are skipped entirely.
  - New sentences from the store batch a reshuffle at most every
    `layout/reshuffleBatchSecs`.
- `fitText.ts`: binary-search largest font ≤ `layout/maxFontPx` whose wrapped
  text fits; returns word-positioned `TextLayout` (per-word x/width +
  `charStart` global char index — spaces counted — used by typewriter/
  scramble/lifecycle cuts). Cache key: font | 4px-bucketed size | cap | text.
  LINE_HEIGHT 1.06 (squeezed). MIN 5px (wall scenes), MAX 400.
- Text sizing: `layout/maxFontPx` caps fitted size (uniform dense look — the
  panel change invalidates all layouts live); `layout/fontScale` (≤1)
  shrinks rendering inside the fit via the sizeScale transform.

## src/effects/ — effect pipeline

`types.ts` contracts:
- `BoxStyle` — mutable per-frame style, reset to neutral each frame, effects
  compose into it in registry order, renderer consumes. Fields: fill,
  opacity, boxFill/boxOpacity, letterSpacing (fraction of fontSize; renderer
  clamps per line so text can't escape), justify/vJustify, sizeScale (≤1 —
  fitted size is ALWAYS the ceiling), visibleChars (−1 = all), dim
  (spotlight/similarWords ducking), perWord Map (fill/boxFill/scale/upper/
  hidden), charOverrides Map (global char index → glyph, scramble),
  ghosts[] (offset translucent copies).
- `EffectCtx` — {g, time, dt, audio: AudioFrame, rng (per-phase seeded),
  params, layout: LayoutHandle {requestReshuffle, requestMorph, setBreathe},
  log}.
- Intensity 0..1 is the scheduler's crossfade weight; effects lerp their
  contribution from neutral. Non-lerpable things (justification) gate
  per-box by hashed probability = intensity.
- Optional: `incompatibleWith`, `wantsSolo`+`soloActive` (similarWords),
  `onPhaseEnter(ctx)` (typewriter/scramble state reset).

`registry.ts` — **EFFECTS array is COMPOSITION ORDER** (matters!):
cascade first (writes per-box intensityOffset the box loop reads), asciiCamera
second (paints the g background under text), then box effects, then
attention globals last so their style writes win (similarWords very last).
`selectionWeight(id, chaos)` gates scheduler picks (asciiCamera >0.35 chaos,
strobeInvert >0.55, globals scale up with chaos). `FX_IDS` in params.ts must
match this registry.

Effects (box): typewriter (beat-advance chunks; composes with lifecycle via
min), wordBoxHighlight (word bg rects, re-picks on beat), wordColor
(recolors on beat subdivisions — flickerRate 0=½-time..1=16ths; high band
widens word coverage), letterSpacingDrift (beat-locked oscillation, mid-band
amplitude), justifyShift (snaps on beat), flashInOut (beat-subdivision
blinks, high band raises odds), caseFlip (slow beat-epoch uppercase; upper
words get 0.82 per-word scale to stay inside the fitted line), scramble
(decode events launch on beats, staggered per box; incompatible w/
typewriter), ghostEcho (offsets ride max(energy, beat thump)).
(global): similarWords — THE signature effect: indexes visible words
(lowercased, stopwords stripped, ≥3 chars), word in ≥2 boxes → simultaneous
white flash across those boxes while everything else dims/ducks (scheduler
multiplies other intensities ×0.25 while soloActive); layoutReshuffle (fires
morphs mostly, `fullProb` rebuilds; interval ÷ chaos ÷ drive); gridBreathe
(low band → setBreathe); spotlight (rotating highlight, others dim); cascade
(reading-order intensity ripple); strobeInvert (frameFlags.invert on beat —
HARD photosensitivity cap ≤4 flashes/sec, do not remove); asciiCamera —
webcam luminance grid; in sentence mode (default) THE TEXT BECOMES THE
ASCII: boxes fade out (`fadeText`) and the visible sentences' characters
flow contiguously through lit cells (luminance → alpha, `threshold` culls
dark cells, `flowSpeed` scrolls). Camera-permission denial self-disables
with a panel log. sizePulse existed once and was removed on request — do not
resurrect.

## src/phases/ — scheduler + scenes

- Phase = 2–5 effects (count/intensity ceilings scale with chaos) picked by
  weighted RNG respecting incompatibilities, + post-uniform targets.
  Crossfade over `crossfadeBeats` (chaos speeds it). Duration in bars with
  jitter. `phases/chaos` (0–1) is the master fader the operator rides.
- `phases/enabled` = false → **manual tuning mode**: scheduler contributes
  zero intensity and zero post drive; only `fx/<id>/intensity` overrides
  run. `phases/freeze` stops advancement; `phases/next` forces.
- Post targets are scheduler-INTERNAL (`postDriveOf`) and merged by the
  renderer via `max(param, drive)` — driving params.set every frame would
  spam the transport/panel. Manual post sliders are therefore minimums.
- `scenes.ts` — **generative layout scenes**: 6 archetypes (monolith 2–5
  huge / poster / columns / rows / mosaic / wall 70–130 tiny-type boxes),
  values sampled per visit, chaos-weighted toward extremes. Applied through
  live `params.set` (panel sliders visibly follow) + reshuffle trigger, on
  phase boundaries after `sceneMinBars/drive` bars with `sceneSwitchProb`.
  `phases/scenesEnabled` off = freeze layout params for hand-tuning;
  `phases/nextScene` forces. Scene name lives in `phaseName` → status bar.

## src/render/

- `renderer.ts`: pipeline above. Box drawing consumes cached TextLayout:
  per-word draws normally; falls to per-char ONLY when letterSpacing ≠ 0,
  charOverrides intersect the word, or a reveal cut lands mid-word. Line
  tracking is clamped to available slack so text never escapes. Ghost passes
  redraw the whole text offset+translucent (no word detail). sizeScale ×
  fontScale scale around rect center (fit stays the ceiling). Beat-monitor
  HUD (bottom-left, `audio/beatMonitor`, default OFF — the panel has its own).
- `post/post.ts` + `post.frag`: raw WebGL2, ping-pong feedback buffers.
  Pass 1 renders scene+effects+trails into the feedback target with
  invert=0/brightness=1; pass 2 presents with invert+brightness.
  **Invert/brightness must stay presentation-only** or they accumulate into
  the trails. Canvas upload uses UNPACK_FLIP_Y_WEBGL so scene and FBO share
  one UV orientation. Uniforms: rgbSplit, feedbackDecay (max(scene, prev×
  decay)), displacement (×energy on CPU), scanlines, noise, bloomish,
  u_invert (strobe via frameFlags), u_brightness. No WebGL2 → falls back to
  showing the raw 2D canvas.
- **Blackout** (`master/blackout`): renderer eases a multiplier toward 0/1
  (tau ~0.4s, runs even while paused) into the presentation-only brightness —
  the VJ stop/start. Requires WebGL2 (fallback path has no brightness).
- **QR screen** (`master/qrShow`): DOM overlay in render main.ts (fixed black
  div + `public/qr.png` in a white frame + CTA + SUBMIT_URL) — DOM, not
  canvas, so the post shader cannot distort the QR into unscannability.
  Engine keeps running underneath.
- `frameFlags.ts`: per-frame flags effects raise (invert), reset each frame.

## src/control/ — panel (the OSC contract)

- `panel.ts` auto-generates from PARAM_DEFS into **four FIXED columns**
  (core | audio+phases+post | box fx | global fx — `COLUMNS` matchers; new
  groups land in column 4). All sections open by default; each column
  scrolls independently — the panel is a static map, NOTHING moves unless
  the user collapses a section (this was an explicit user requirement after
  CSS `columns` rebalancing annoyed them). `fx:` section headers host the
  effect's enabled checkbox (stopPropagation so it doesn't toggle the
  details; red OFF tag).
- `main.ts`: status bar (connection, fps, `bpm (mode) · detects N (%)`,
  `motion ×drive`, phase·scene, audio status, beat dot, band meter,
  beat-monitor widget with det/grid dots + relative flux bar + `N det/5s`
  counter), presets (named slots, localStorage), `clear fx overrides`,
  audio device scan (needs a granted stream once for labels), audio file
  upload (ArrayBuffer over the transport; render window needs one prior
  click for the AudioContext gesture), log footer (fixed).

## src/data/sentences.ts

`SentenceStore` interface (getAll/getBuiltin/getExternal/onAdded). ~230
built-in sentences (multilingual sprinkle, 3–20 words, warm/funny/sincere) and
an external pool (Supabase/sentences.json) kept SEPARATE internally; `getAll()`
still merges. **DB mix**: `data/dbMix` (0–1, fraction of sentence picks drawn
from the external pool) and `data/dbTakeoverAt` (int, default 50 — external
count ≥ this forces mix = 1 and logs `crowd takeover` once). layoutEngine's
`nextSentence()` + initial reshuffle picks are weighted draws with per-pool
cursors (side RNG); effectiveMix = 0 while the external pool is empty.
`data/injectRandom` trigger adds one to the EXTERNAL pool (simulates a crowd
submission, exercising the mix path).
`loadExternal()` fetches optional `/public/sentences.json` (JSON array of
strings; deduped; 3–24 words) at startup — the dataset drop-in.
`addExternal(raw)` is the LIVE ingress (Supabase): collapses whitespace/line
breaks (layout is word-based), bounds 3–300 chars / ≤40 words, dedupes, then
fires `onAdded` → layout batches a reshuffle. Poems arrive as one line.

## src/data/ — Supabase audience submissions (STAGE 2, LIVE)

The "sentences about friends from the crowd" pipeline is built and deployed.
- **Submission site**: `docs/index.html` — a plain black terminal-style HTML
  form, hosted on **GitHub Pages** (repo `PinknMatter/friends-infatuated`,
  `master:/docs`, deployed by `.github/workflows/pages.yml` — an Actions
  static deploy, NOT Jekyll). Live at
  `https://pinknmatter.github.io/friends-infatuated/`. Has a honeypot field
  (`website`) + client length guard. **Why Pages and not Supabase**: the
  Supabase gateway forces `Content-Type: text/plain` on any HTML served from
  `*.supabase.co` (anti-phishing) — browsers show source, not a page. So the
  page is static-hosted and only the write API lives on Supabase.
- **Write API**: Supabase edge function `submit`
  (`supabase/functions/submit/index.ts`), `verify_jwt=false`. POST JSON
  `{text, author?, website?}` → validates → inserts with the SERVICE ROLE
  (the table has NO public INSERT policy; this function is the only door in).
  Honeypot filled → fake-success no-op. GET/HEAD → 302 to the Pages site.
  CORS open (the form is cross-origin on github.io).
- **Read path**: `supabaseSync.ts` (`startSupabaseSync`) polls PostgREST every
  8s with the PUBLISHABLE key: `sentences?approved=is.true&id=gt.<lastId>` →
  `store.addExternal`. No supabase-js, no websocket (venue wifi drops must not
  kill visuals); network errors are silent and retried next tick. First load
  logs a count; deltas log `+N new from the crowd`. Wired in `main.ts`.
- **DB**: table `public.sentences` (id identity, text 3–300 check, author,
  `approved` bool default TRUE, created_at). RLS: SELECT where approved only.
  To add moderation later, flip the default to FALSE and build an approve UI —
  the read path already filters on `approved`.
- **Config**: `supabaseConfig.ts` holds URL + publishable key (safe in the
  browser — RLS-gated read only) + `SUBMIT_URL` (the Pages site). Empty URL/
  key ⇒ sync is a no-op and the engine runs on the built-in pool alone.
- **Project**: Supabase project `slopgzmjfkdccgxlmdzi`, org
  `FriendsInfactuated`. The `probe` edge function is a retired diagnostic
  (redirects to the site) — safe to delete.
- **QR**: `qr-code.png` (800px) / `qr-code.svg` (print) at repo root encode
  the Pages URL. Regenerate: `npx qrcode "<url>" -o qr-code.png -w 800`.

## Gotchas (hard-won — do not rediscover)

1. **p5 quote-wraps the entire `textFont` string** if it contains whitespace
   → a CSS font stack becomes ONE bogus family and silently falls back to
   Times. `src/core/fonts.ts` entries must be a SINGLE family name; the face
   is loaded explicitly (`document.fonts.load`) then all layouts
   invalidated. Font file: `public/fonts/SpaceGrotesk.woff2`.
2. WebGL canvas reads outside its rAF are black (no preserveDrawingBuffer).
3. Headless fps invalidates beat-detection tests — use `npm run test:audio`.
4. Band boosts must not clamp before auto-gain (flattens loud bands).
5. Auto-gain floor is capped at 55% of peak — removing the cap makes
   compressed music collapse all bands to zero (real user-reported bug).
6. Beat detection must stay level-independent (flux ÷ spectral energy). Any
   absolute threshold floor breaks low input gain (real user-reported bug).
7. Clock auto-mode re-anchor must preserve the beat COUNT (see clock section)
   or phases freeze.
8. Post invert/brightness are presentation-only (trails corruption).
9. Scheduler post targets merge via max() with params — never params.set
   per frame (transport/panel spam).
10. strobeInvert ≤4 flashes/sec cap is a photosensitivity safety line.
11. PowerShell 5.1 mangles embedded double quotes passed to git commit -m;
    here-strings with `"` inside can split into pathspecs. Avoid quotes in
    commit messages.
12. Effects NEVER mutate rects; layout params changed by scenes go through
    params.set so the panel stays truthful.
13. Rhythmic effects sync to `audio.beatPos` epochs, not wall-clock seconds
    — that's what makes manual BPM actually drive everything.

## Future seams

- **Moderation**: flip the sentences table `approved` default to FALSE and
  build an approve UI — the read path already filters on `approved`.
- **Multi-font**: every box already carries `fontId` resolved through
  `src/core/fonts.ts` — add entries + @font-face, assign per box in the
  layout engine.

## Style notes

- All randomness through `src/core/rng.ts` (mulberry32) — keep determinism
  from `master/seed` where feasible (lifecycle uses a fixed-seed side RNG).
- Effects are one file each, default-export a const object, no classes.
- Comments explain constraints/why, not what.
- Milestone-style commits; verify with typecheck + smoke/audio tests before
  claiming done. Screenshots via Playwright are the ground truth for visual
  claims.
