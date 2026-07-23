// OSC → WebSocket bridge. TouchOSC (or anything speaking OSC over UDP) sends
// to port 9000; the render window connects to ws://<host>:8765 (see
// src/core/wsTransport.ts) and receives Transport-shaped JSON messages:
//   /param/<path> <value>  →  { type: 'param-set', path, value }
//   /trigger/<path>        →  { type: 'param-trigger', path }
// The parser is hand-rolled (no runtime OSC dep): OSC 1.0 messages are just a
// null-padded address, a ','-prefixed type-tag string, then big-endian args.
// Supported tags: f, i, s, T, F. Bundles (#bundle) are unpacked recursively;
// timetags are ignored — live control wants "now", not scheduled delivery.

import dgram from 'node:dgram';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const OSC_PORT = 9000;
const WS_PORT = 8765;

// ---- OSC parsing -----------------------------------------------------------

const align4 = (n) => (n + 3) & ~3;

/** Read a null-terminated, 4-byte-padded OSC string. Returns [string, nextOffset]. */
function readOscString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null; // unterminated — malformed packet
  return [buf.toString('utf8', off, end), align4(end + 1)];
}

/** Parse one OSC message. Returns { address, args } or null on malformed/unsupported. */
function parseMessage(buf) {
  const addr = readOscString(buf, 0);
  if (!addr || !addr[0].startsWith('/')) return null;
  const [address, tagOff] = addr;

  const tags = readOscString(buf, tagOff);
  // Type-tag string is technically optional in ancient OSC; treat absent as zero args.
  if (!tags || !tags[0].startsWith(',')) return { address, args: [] };
  const [tagStr, argStart] = tags;

  const args = [];
  let off = argStart;
  for (const tag of tagStr.slice(1)) {
    switch (tag) {
      case 'f': {
        if (off + 4 > buf.length) return null;
        // float32 noise (0.8 → 0.80000001…) would leak into params/panel; trim it.
        args.push(Number(buf.readFloatBE(off).toFixed(6)));
        off += 4;
        break;
      }
      case 'i': {
        if (off + 4 > buf.length) return null;
        args.push(buf.readInt32BE(off));
        off += 4;
        break;
      }
      case 's': {
        const s = readOscString(buf, off);
        if (!s) return null;
        args.push(s[0]);
        off = s[1];
        break;
      }
      case 'T':
        args.push(true);
        break;
      case 'F':
        args.push(false);
        break;
      default:
        // Unknown tag → we can no longer trust arg offsets; drop the message.
        console.log(`[osc] unsupported type tag '${tag}' in ${address} — dropped`);
        return null;
    }
  }
  return { address, args };
}

/** Unpack a datagram into messages (recursing into bundles). */
function parsePacket(buf, out) {
  if (buf.length >= 8 && buf.toString('ascii', 0, 7) === '#bundle') {
    let off = 16; // '#bundle\0' + 8-byte timetag (ignored)
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off);
      off += 4;
      if (size <= 0 || off + size > buf.length) break;
      parsePacket(buf.subarray(off, off + size), out);
      off += size;
    }
    return;
  }
  const msg = parseMessage(buf);
  if (msg) out.push(msg);
}

// ---- translation -----------------------------------------------------------

// TouchOSC's DEFAULT message address is /<page>/<controlName> — its importer
// drops custom osc_cs addresses from legacy layouts, so we map control NAMES
// too. A stock layout then works with zero message editing on the phone: name
// a control 'blackout' (or keep the generated c0..c4 names) and it just works.
// scale: [min,max] maps a raw 0..1 fader onto the param's range; values
// already outside 0..1 are passed through (assume the phone scaled them).
const NAME_ALIASES = {
  c0: { path: 'audio/manualBpm', scale: [70, 180] },
  bpm: { path: 'audio/manualBpm', scale: [70, 180] },
  c1: { path: 'phases/chaos' },
  chaos: { path: 'phases/chaos' },
  choas: { path: 'phases/chaos' }, // the operator's actual control name
  c2: { path: 'phases/next', trigger: true },
  skip: { path: 'phases/next', trigger: true },
  skipphase: { path: 'phases/next', trigger: true },
  c3: { path: 'master/qrShow' },
  qr: { path: 'master/qrShow' },
  qrscreen: { path: 'master/qrShow' },
  c4: { path: 'master/blackout' },
  blackout: { path: 'master/blackout' },
  mbpm: { path: 'audio/useManualBpm' },
  manualbpm: { path: 'audio/useManualBpm' },
  usemanualbpm: { path: 'audio/useManualBpm' },
  taptempo: { path: 'audio/tapTempo', trigger: true },
  tap: { path: 'audio/tapTempo', trigger: true },
  tapchaos: { path: 'phases/pulse', trigger: true },
  pulse: { path: 'phases/pulse', trigger: true },
  punch: { path: 'phases/pulse', trigger: true },
  // 'shift the grid' = morph (ratios glide, boxes keep their sentences)
  shufflegridnow: { path: 'layout/morph', trigger: true },
  shiftgrid: { path: 'layout/morph', trigger: true },
  morph: { path: 'layout/morph', trigger: true },
  // full rebuild stays reachable under explicit names
  shuffle: { path: 'layout/reshuffle', trigger: true },
  reshuffle: { path: 'layout/reshuffle', trigger: true },
};

/** OSC message → TransportMessage JSON, or null if the address is not ours. */
function translate({ address, args }) {
  if (address.startsWith('/param/')) {
    const path = address.slice('/param/'.length);
    if (args.length < 1) {
      console.log(`[osc] ${address} needs a value arg — dropped`);
      return null;
    }
    return { type: 'param-set', path, value: args[0] };
  }
  if (address.startsWith('/trigger/')) {
    // TouchOSC buttons send 1 on press AND 0 on release — firing on the
    // release edge would double every trigger. No-arg packets always fire.
    if (args.length && (args[0] === 0 || args[0] === false)) return null;
    return { type: 'param-trigger', path: address.slice('/trigger/'.length) };
  }
  // TouchOSC default addresses: match the final segment against the alias
  // table (case/spacing-insensitive: 'M BPM' → 'mbpm').
  const name = address.split('/').filter(Boolean).pop() ?? '';
  const alias = NAME_ALIASES[name.toLowerCase().replace(/[^a-z0-9]/gi, '')];
  if (alias) {
    if (alias.trigger) {
      if (args.length && (args[0] === 0 || args[0] === false)) return null; // button release
      return { type: 'param-trigger', path: alias.path };
    }
    if (args.length < 1) return null;
    let value = args[0];
    if (alias.scale && typeof value === 'number' && value >= 0 && value <= 1) {
      value = alias.scale[0] + value * (alias.scale[1] - alias.scale[0]);
    }
    return { type: 'param-set', path: alias.path, value };
  }
  console.log(`[osc] unknown address ${address} — ignored (use /param/..., /trigger/..., or a known control name)`);
  return null;
}

// ---- servers ---------------------------------------------------------------

const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws, req) => {
  console.log(`[ws] client connected (${req.socket.remoteAddress}) — ${wss.clients.size} total`);
  ws.on('close', () => console.log(`[ws] client disconnected — ${wss.clients.size} total`));
  ws.on('error', () => {});
  // Inbound WS traffic (render-window status relays etc.) is not our concern; drop it.
  ws.on('message', () => {});
});
wss.on('error', (err) => {
  console.error(`[ws] server error: ${err.message}`);
  process.exit(1);
});

const udp = dgram.createSocket('udp4');
udp.on('message', (buf, rinfo) => {
  const msgs = [];
  try {
    parsePacket(buf, msgs);
  } catch {
    console.log(`[osc] malformed packet from ${rinfo.address} — dropped`);
    return;
  }
  for (const osc of msgs) {
    const json = translate(osc);
    if (!json) continue;
    const argStr = osc.args.length ? ` ${osc.args.join(' ')}` : '';
    console.log(
      `[osc] ${osc.address}${argStr}  →  ${json.type} ${json.path}` +
        ('value' in json ? ` = ${json.value}` : ''),
    );
    const payload = JSON.stringify(json);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }
});
udp.on('error', (err) => {
  console.error(`[udp] error: ${err.message}`);
  process.exit(1);
});
udp.bind(OSC_PORT, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('FRIENDS INFATUATED — OSC bridge');
  console.log(`  OSC in (UDP):   port ${OSC_PORT}   ← point TouchOSC here`);
  console.log(`  WebSocket out:  port ${WS_PORT}   ← render window connects automatically`);
  console.log(`  This machine's LAN IP(s): ${ips.length ? ips.join(', ') : '(none found — check wifi/ethernet)'}`);
  console.log('  Waiting for OSC…');
});
