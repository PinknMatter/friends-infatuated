# Stage 3: live controls, NDI, OSC, DB mix, flash spawn, QR screen, blackout, poster

Date: 2026-07-23. Approved in conversation (NDI = external capture, phone = TouchOSC, stop = blackout).

## 1. NDI output (docs only, no engine code)

The render window stays a fullscreen browser window; NDI capture happens outside it.
Deliverable: `docs/NDI.md` covering two paths:
- **NDI Tools Screen Capture** (zero config): install via winget, pick the Chrome window, done.
- **OBS + DistroAV (obs-ndi)**: window capture source -> NDI output named `FRIENDS INFATUATED`.
Include winget install commands, a show-night checklist (1920x1080, 60fps, disable browser HW-accel pitfalls, fullscreen F11), and how a receiver (Resolume etc.) finds the source.

## 2. OSC bridge (TouchOSC -> engine)

- New `scripts/osc-bridge.mjs` (Node, dep: `ws`; OSC UDP parsing hand-rolled or via `osc-min`):
  - UDP OSC server on **9000**; WebSocket server on **8765**.
  - `/param/<path> <value>` -> Transport `param-set` (float/int/bool/string args passed through).
  - `/trigger/<path>` (any or no arg) -> `param-trigger`.
  - Logs each translated message; prints LAN IP + ports on startup.
  - `npm run osc` script in package.json.
- New `src/core/wsTransport.ts`: `attachOscBridge(base: Transport, url = 'ws://localhost:8765'): Transport`
  - Returns a composite Transport: everything sent goes to both legs; messages received on either leg
    are delivered to listeners AND relayed to the other leg (no echo back onto the leg it arrived on),
    so panel (BroadcastChannel) stays truthful when OSC changes params.
  - Silent reconnect forever (2s backoff). Bridge down = zero errors, zero behavior change.
- Wiring: render-window `main.ts` wraps its BroadcastTransport with `attachOscBridge(...)`. Render only
  (it is the authoritative store); the panel keeps plain BroadcastChannel.
- `docs/OSC.md`: address map for the TouchOSC layout:
  - Skip Phase: `/trigger/phases/next`
  - Chaos: `/param/phases/chaos` (0..1)
  - Manual BPM: `/param/audio/manualBpm` (70..180)
  - QR screen: `/param/master/qrShow` (0/1)
  - Stop/Start: `/param/master/blackout` (0/1)
  plus the generic rule so any of the ~130 params is reachable.

## 3. DB vs built-in sentence mix

- `sentences.ts`: track origin. Builtin pool and external (Supabase/JSON) pool kept separate;
  `getAll()` remains for existing consumers; add `getBuiltin()`, `getExternal()`.
- New params (group `data`): `data/dbMix` float 0..1 default 0.5 (fraction of picks from DB pool),
  `data/dbTakeoverAt` int default 50 (external count >= this forces mix = 1).
- `layoutEngine`: initial layout picks and `nextSentence()` become weighted draws: rng < effectiveMix
  -> external cursor, else builtin cursor. effectiveMix = 0 when external empty; 1 at takeover.
- Log once when takeover activates ("crowd takeover: N sentences, builtins retired").

## 4. Flash spawn (no type-in/out on some phases)

- New param `layout/spawnStyle` enum `type | flash`, default `type`.
- New param `phases/flashProb` float 0..1 default 0.3: on each phase boundary the scheduler rolls and
  `params.set('layout/spawnStyle', ...)` (same pattern as scenes -> panel stays truthful; respects
  `phases/enabled` off = leave alone for hand-tuning).
- Lifecycle in flash mode: spawn -> whole sentence with a ~0.3s blink flicker (alternate all/none every
  ~60ms), live lifetime, then instant cut to 0 (no backspace). Type speeds unused in this mode.

## 5. QR screen

- New param `master/qrShow` bool default false.
- Render window: DOM overlay (fullscreen black div over the canvas, centered `public/qr.png` in a white
  frame + CTA text + submit URL from `supabaseConfig.SUBMIT_URL`), toggled by param onChange.
  DOM (not canvas) so the post shader cannot distort the QR into unscannability.
- `public/qr.png` copied from repo-root `qr-code.png`.
- Reachable from panel checkbox + `/param/master/qrShow`.

## 6. Stop/start = blackout

- New param `master/blackout` bool default false.
- Renderer keeps an eased multiplier (approach 0 or 1, ~0.4s) multiplied into the presentation-only
  `u_brightness` uniform. Trails/feedback unaffected (gotcha 8). Engine, phases, audio all keep running.

## 7. Figma poster

- In the provided Figma file: a simple poster that feels like a freeze frame of a phase —
  black field, BSP-ish arrangement of sentence fragments from the pool — but styled old-HTML
  (system serif/mono, bevels/underlines, default-blue link accents). QR code (uploaded from repo
  `qr-code.png`) + a CTA that actually pulls people in. Built via the Figma MCP tools.

## 8. Social link on the submission site

- `docs/index.html` (the GitHub Pages form): add a follow link to
  `https://instagram.com/noahhkorn` (text link, e.g. `@noahhkorn` styled like the page's
  terminal aesthetic), placed under the form/footer so it does not compete with the submit CTA.

## Verification

- `npm run typecheck`, `npm run test:audio`, `node scripts/smoke.mjs` all green.
- OSC: scripted UDP send (`/param/phases/chaos 0.8`, `/trigger/phases/next`) against the bridge with
  the dev server up; confirm the render store changed (status broadcast or screenshot).
- QR/blackout/flash: Playwright screenshots as ground truth.

## Ownership / conflict partition

- Agent A (worktree): `scripts/osc-bridge.mjs`, `src/core/wsTransport.ts`, `package.json`,
  `docs/OSC.md`, `docs/NDI.md`, one-line wiring in render `main.ts`. Merged after.
- Agent B (main tree): `params.ts`, `sentences.ts`, `layoutEngine.ts`, scheduler, `renderer.ts`,
  render `main.ts` (QR overlay), `public/qr.png`.
- CLAUDE.md updated once at the end by the orchestrator, not by agents.
