# OSC control (TouchOSC → engine)

A small Node bridge translates OSC over UDP into the engine's Transport
messages over a WebSocket. The render window connects to the bridge
automatically (and silently retries every ~2s if it isn't running — you can
start the bridge at any point, even mid-show).

## Start the bridge

```
npm run osc
```

Run it on the same machine as the render window. On startup it prints this
machine's LAN IP address(es) and both ports:

- **UDP 9000** — OSC in (point TouchOSC here)
- **WS 8765** — WebSocket out (the render window connects to this on its own)

## TouchOSC setup

1. Phone/tablet must be on the **same wifi/LAN** as the laptop running the
   bridge.
2. In TouchOSC: Connections → OSC →
   - **Host**: the LAN IP printed by `npm run osc` (e.g. `192.168.1.42`)
   - **Send port**: `9000`
   - **Protocol**: `UDP`
3. Receive port doesn't matter — the bridge never sends OSC back.

## Ready-made layout

`friends-infatuated.touchosc` at the repo root is a complete show layout
(landscape, phone-sized): BPM fader (70–180), CHAOS fader, SKIP PHASE button,
QR SCREEN toggle, BLACKOUT toggle — already wired to the addresses below.
Get it onto the phone (AirDrop / Files / Drive / email), open it in TouchOSC
(current app opens this legacy format directly), set the connection per the
setup above, and hit play. Regenerate/tweak: the layout is just a zip
containing one `index.xml` (control names/labels are base64).

## Address map (show layout)

| Control | Address | Args / range |
| --- | --- | --- |
| Skip phase (button) | `/trigger/phases/next` | none (button press value ignored) |
| Chaos (fader) | `/param/phases/chaos` | float 0–1 |
| Manual BPM (fader) | `/param/audio/manualBpm` | float 70–180 |
| QR screen (toggle) | `/param/master/qrShow` | 0 / 1 |
| Stop/Start = blackout (toggle) | `/param/master/blackout` | 0 / 1 |

`master/qrShow` and `master/blackout` are added by the stage-3 render-side
work (QR overlay + eased brightness blackout) — the addresses above are live
once that lands; the bridge needs no change either way, it forwards any path.

## Generic rules — every param is reachable

The bridge doesn't know the param registry; it forwards **any** path:

- `/param/<path> <value>` → sets the param at `<path>` (see
  `src/core/params.ts` for all ~130 paths). Floats and ints pass through as
  numbers; OSC `T`/`F` tags become true/false; bool params also accept 0/1.
  Values are clamped to the param's min/max by the store.
- `/trigger/<path>` → fires the trigger param at `<path>`. A `0`/`false`
  first arg is treated as a button **release** and ignored (TouchOSC buttons
  send 1 on press and 0 on release — without this every tap would fire
  twice). No-arg packets and any non-zero arg fire.

More examples:

| Address | Effect |
| --- | --- |
| `/trigger/layout/morph` | grid morph (ratios glide, boxes keep sentences) |
| `/trigger/layout/reshuffle` | full layout rebuild |
| `/param/post/feedbackDecay 0.9` | video-feedback trails (manual minimum — scheduler can push higher) |
| `/param/phases/enabled 0` | manual tuning mode (scheduler contributes nothing) |
| `/param/fx/strobeInvert/enabled 0` | hard-kill an effect |

Unknown addresses (anything not `/param/...` or `/trigger/...`) are logged by
the bridge and ignored. Each translated message is logged on one line, so the
bridge console doubles as an OSC monitor.

## How it plugs in (for devs)

`scripts/osc-bridge.mjs` (UDP 9000 → WS 8765, hand-rolled OSC parser, types
f/i/s/T/F + `#bundle`) broadcasts `{type:'param-set'|'param-trigger', ...}`
JSON to all WS clients. `src/core/wsTransport.ts` (`attachOscBridge`) wraps
the render window's BroadcastTransport: WS messages are applied to the
authoritative store AND relayed onto the BroadcastChannel so the control
panel's mirrored store stays truthful. `audio-file` messages never cross the
WS leg (ArrayBuffer doesn't JSON-serialize).
