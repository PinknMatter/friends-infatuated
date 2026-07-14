// Control panel entry. Mirrors the param store over the Transport (render
// window is authoritative), auto-generates the UI, and shows live status.
// This panel is the contract for the later OSC bridge: everything it does
// flows through params.set / params.trigger.

import { ParamStore, PARAM_DEFS, FX_IDS, type ParamValue } from '../core/params';
import { BroadcastTransport, type StatusPayload } from '../core/transport';
import { buildPanel } from './panel';

const params = new ParamStore(PARAM_DEFS);
const transport = new BroadcastTransport();
params.bindTransport(transport, 'control');

buildPanel(document.getElementById('panel')!, params);

// Reset every fx intensity override back to auto (scheduler-driven).
document.getElementById('clearOverrides')!.addEventListener('click', () => {
  for (const id of FX_IDS) params.set(`fx/${id}/intensity`, -1);
});

// ---- audio file upload → render window ----

const audioInput = document.getElementById('audioFile') as HTMLInputElement;
audioInput.addEventListener('change', async () => {
  const file = audioInput.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  transport.send({ type: 'audio-file', name: file.name, buffer });
  const log = document.getElementById('log')!;
  const line = document.createElement('div');
  line.textContent = `sent audio file: ${file.name} (${(buffer.byteLength / 1e6).toFixed(1)} MB)`;
  log.prepend(line);
  audioInput.value = ''; // allow re-uploading the same file
});

// ---- status bar ----

const el = (id: string) => document.getElementById(id)!;
let lastStatusTime = 0;
let lastStatus: StatusPayload | null = null;

transport.onMessage((msg) => {
  if (msg.type === 'status') {
    lastStatusTime = performance.now();
    lastStatus = msg.payload;
  } else if (msg.type === 'log') {
    const log = el('log');
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} ${msg.text}`;
    log.prepend(line);
    while (log.children.length > 30) log.lastChild?.remove();
  }
});

const meter = el('meter') as HTMLCanvasElement;
const meterCtx = meter.getContext('2d')!;

function renderStatus(): void {
  const connected = performance.now() - lastStatusTime < 3000;
  el('conn').textContent = connected ? '● connected' : '○ disconnected';
  el('conn').className = connected ? 'ok' : 'bad';
  if (lastStatus) {
    el('fps').textContent = `${lastStatus.fps} fps`;
    el('phase').textContent = `phase ${lastStatus.phase} · ${lastStatus.boxCount} boxes`;
    el('bpm').textContent = `${lastStatus.bpm} bpm (${lastStatus.bpmMode})`;
    el('audioStatus').textContent = `audio: ${lastStatus.audioStatus}`;
    el('effects').textContent = lastStatus.effects
      .map((e) => `${e.id} ${(e.intensity * 100) | 0}%`)
      .join('  ·  ') || '(no active effects)';
    if (lastStatus.beat) {
      el('beat').classList.add('on');
      setTimeout(() => el('beat').classList.remove('on'), 120);
    }
    // Meter strip: low / mid / high / energy.
    const bands = [lastStatus.bands.low, lastStatus.bands.mid, lastStatus.bands.high, lastStatus.energy];
    const colors = ['#e5484d', '#f0b429', '#3b9eff', '#8f8f8f'];
    meterCtx.clearRect(0, 0, meter.width, meter.height);
    bands.forEach((v, i) => {
      meterCtx.fillStyle = colors[i];
      const barH = meter.height / 4 - 2;
      meterCtx.fillRect(0, i * (barH + 2), v * meter.width, barH);
    });
  }
  requestAnimationFrame(renderStatus);
}
renderStatus();

// Re-request state sync every few seconds until connected (render window may
// open after the panel).
const syncPoll = setInterval(() => {
  if (performance.now() - lastStatusTime < 3000) {
    clearInterval(syncPoll);
    return;
  }
  transport.send({ type: 'sync-request' });
}, 2000);

// ---- presets (localStorage) ----

const PRESET_KEY = 'friends-infatuated-presets';

function readPresets(): Record<string, Record<string, ParamValue>> {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function refreshPresetList(): void {
  const select = el('presetList') as HTMLSelectElement;
  select.innerHTML = '';
  for (const name of Object.keys(readPresets())) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    select.appendChild(o);
  }
}
refreshPresetList();

el('presetSave').addEventListener('click', () => {
  const name = (el('presetName') as HTMLInputElement).value.trim();
  if (!name) return;
  const presets = readPresets();
  presets[name] = params.serialize();
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  refreshPresetList();
});

el('presetLoad').addEventListener('click', () => {
  const name = (el('presetList') as HTMLSelectElement).value;
  const preset = readPresets()[name];
  if (preset) params.deserialize(preset); // each set broadcasts to the render window
});

el('presetDelete').addEventListener('click', () => {
  const name = (el('presetList') as HTMLSelectElement).value;
  const presets = readPresets();
  delete presets[name];
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  refreshPresetList();
});

// ---- audio device picker ----

el('scanDevices').addEventListener('click', async () => {
  try {
    // Need a granted stream once so enumerateDevices returns labels.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of probe.getTracks()) track.stop();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const select = document.querySelector<HTMLSelectElement>(
      'select[data-path="audio/deviceId"]',
    );
    if (!select) return;
    select.innerHTML = '';
    const def = document.createElement('option');
    def.value = 'default';
    def.textContent = 'default';
    select.appendChild(def);
    for (const d of devices.filter((d) => d.kind === 'audioinput')) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || d.deviceId.slice(0, 12);
      select.appendChild(o);
    }
    select.value = params.str('audio/deviceId');
  } catch (err) {
    const log = el('log');
    const line = document.createElement('div');
    line.textContent = `device scan failed: ${err instanceof Error ? err.name : err}`;
    log.prepend(line);
  }
});
