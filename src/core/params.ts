// THE parameter registry — single source of truth for everything tunable.
// Control panel auto-generates from PARAM_DEFS; OSC addresses derive from paths later.
// All runtime mutation flows through ParamStore.set / .trigger.

import type { Transport, TransportMessage } from './transport';

export type ParamType = 'float' | 'int' | 'bool' | 'enum' | 'trigger';
export type ParamValue = number | boolean | string;

export interface ParamDef {
  path: string; // 'phases/chaos', 'post/rgbSplit', 'fx/typewriter/speed'
  type: ParamType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[]; // enum
  label: string;
  group: string; // control panel section
}

export interface ParamReader {
  get(path: string): ParamValue;
  num(path: string): number;
  bool(path: string): boolean;
  str(path: string): string;
}

type ChangeCb = (value: ParamValue, path: string) => void;

export class ParamStore implements ParamReader {
  private defs = new Map<string, ParamDef>();
  private values = new Map<string, ParamValue>();
  private listeners = new Map<string, ChangeCb[]>();
  private anyListeners: ChangeCb[] = [];
  private transport: Transport | null = null;
  private authoritative = false;

  constructor(defs: ParamDef[]) {
    for (const def of defs) {
      if (this.defs.has(def.path)) throw new Error(`Duplicate param path: ${def.path}`);
      this.defs.set(def.path, def);
      // Triggers store a fire-counter so onChange fires on every trigger.
      this.values.set(def.path, def.type === 'trigger' ? 0 : def.default);
    }
  }

  allDefs(): ParamDef[] {
    return [...this.defs.values()];
  }

  def(path: string): ParamDef {
    const d = this.defs.get(path);
    if (!d) throw new Error(`Unknown param: ${path}`);
    return d;
  }

  get(path: string): ParamValue {
    const v = this.values.get(path);
    if (v === undefined) throw new Error(`Unknown param: ${path}`);
    return v;
  }

  num(path: string): number {
    return this.get(path) as number;
  }

  bool(path: string): boolean {
    return this.get(path) as boolean;
  }

  str(path: string): string {
    return this.get(path) as string;
  }

  set(path: string, value: ParamValue, opts: { broadcast?: boolean } = {}): void {
    const def = this.def(path);
    if (def.type === 'float' || def.type === 'int') {
      let n = Number(value);
      if (def.min !== undefined) n = Math.max(def.min, n);
      if (def.max !== undefined) n = Math.min(def.max, n);
      if (def.type === 'int') n = Math.round(n);
      value = n;
    }
    if (this.values.get(path) === value) return;
    this.values.set(path, value);
    this.emit(path, value);
    if (opts.broadcast !== false && this.transport) {
      this.transport.send({ type: 'param-set', path, value });
    }
  }

  /** Fire a momentary trigger param. */
  trigger(path: string, opts: { broadcast?: boolean } = {}): void {
    const def = this.def(path);
    if (def.type !== 'trigger') throw new Error(`Not a trigger: ${path}`);
    const count = (this.values.get(path) as number) + 1;
    this.values.set(path, count);
    this.emit(path, count);
    if (opts.broadcast !== false && this.transport) {
      this.transport.send({ type: 'param-trigger', path });
    }
  }

  onChange(path: string, cb: ChangeCb): () => void {
    this.def(path); // validate
    const arr = this.listeners.get(path) ?? [];
    arr.push(cb);
    this.listeners.set(path, arr);
    return () => {
      const a = this.listeners.get(path);
      if (a) a.splice(a.indexOf(cb), 1);
    };
  }

  onAnyChange(cb: ChangeCb): void {
    this.anyListeners.push(cb);
  }

  private emit(path: string, value: ParamValue): void {
    for (const cb of this.listeners.get(path) ?? []) cb(value, path);
    for (const cb of this.anyListeners) cb(value, path);
  }

  // ---- serialization (presets) ----

  serialize(): Record<string, ParamValue> {
    const out: Record<string, ParamValue> = {};
    for (const [path, def] of this.defs) {
      if (def.type === 'trigger') continue;
      out[path] = this.values.get(path)!;
    }
    return out;
  }

  deserialize(state: Record<string, ParamValue>, opts: { broadcast?: boolean } = {}): void {
    for (const [path, value] of Object.entries(state)) {
      if (!this.defs.has(path)) continue; // tolerate stale presets
      if (this.defs.get(path)!.type === 'trigger') continue;
      this.set(path, value, opts);
    }
  }

  // ---- transport binding ----

  /**
   * Bind to a transport. The render window is authoritative: it answers
   * sync-requests with full state. The control panel requests sync on connect.
   */
  bindTransport(transport: Transport, role: 'render' | 'control'): void {
    this.transport = transport;
    this.authoritative = role === 'render';
    transport.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'param-set':
          if (this.defs.has(msg.path)) this.set(msg.path, msg.value, { broadcast: false });
          break;
        case 'param-trigger':
          if (this.defs.has(msg.path)) this.trigger(msg.path, { broadcast: false });
          break;
        case 'sync-request':
          if (this.authoritative) {
            transport.send({ type: 'sync-state', state: this.serialize() });
          }
          break;
        case 'sync-state':
          if (!this.authoritative) this.deserialize(msg.state, { broadcast: false });
          break;
      }
    });
    if (role === 'control') transport.send({ type: 'sync-request' });
  }
}

// ---------------------------------------------------------------------------
// Parameter definitions
// ---------------------------------------------------------------------------

const F = (
  path: string,
  label: string,
  group: string,
  def: number,
  min: number,
  max: number,
  step = 0.01,
): ParamDef => ({ path, type: 'float', default: def, min, max, step, label, group });

const I = (
  path: string,
  label: string,
  group: string,
  def: number,
  min: number,
  max: number,
): ParamDef => ({ path, type: 'int', default: def, min, max, step: 1, label, group });

const B = (path: string, label: string, group: string, def: boolean): ParamDef => ({
  path,
  type: 'bool',
  default: def,
  label,
  group,
});

const T = (path: string, label: string, group: string): ParamDef => ({
  path,
  type: 'trigger',
  default: 0,
  label,
  group,
});

const E = (
  path: string,
  label: string,
  group: string,
  def: string,
  options: string[],
): ParamDef => ({ path, type: 'enum', default: def, options, label, group });

export const PARAM_DEFS: ParamDef[] = [
  // ---- master ----
  F('master/brightness', 'Brightness', 'master', 1, 0, 1),
  I('master/bgGray', 'Background gray', 'master', 0, 0, 60),
  I('master/seed', 'Seed', 'master', 1337, 1, 999999),
  B('master/paused', 'Paused', 'master', false),
  E('master/fontId', 'Font', 'master', 'main', ['main']),

  // ---- layout ----
  I('layout/minBoxes', 'Min boxes', 'layout', 10, 2, 40),
  I('layout/maxBoxes', 'Max boxes', 'layout', 22, 2, 40),
  F('layout/rowBias', 'Row bias (rows vs grid)', 'layout', 0.75, 0, 1),
  F('layout/splitBiasLow', 'Split ratio min', 'layout', 0.3, 0.1, 0.5),
  F('layout/splitBiasHigh', 'Split ratio max', 'layout', 0.7, 0.5, 0.9),
  I('layout/minBoxW', 'Min box width px', 'layout', 260, 80, 600),
  I('layout/minBoxH', 'Min box height px', 'layout', 56, 30, 400),
  I('layout/gutter', 'Gutter px', 'layout', 4, 0, 60),
  I('layout/padding', 'Text padding px', 'layout', 7, 0, 60),
  F('layout/transitionDur', 'Transition secs', 'layout', 1.2, 0.1, 5),
  F('layout/morphDur', 'Grid morph secs', 'layout', 2.2, 0.2, 8),
  T('layout/reshuffle', 'Reshuffle now', 'layout'),
  T('layout/morph', 'Shift grid now', 'layout'),
  I('layout/reshuffleBatchSecs', 'New-sentence batch secs', 'layout', 20, 2, 120),

  // ---- audio ----
  // deviceId options are extended at runtime by the control panel after enumerateDevices
  E('audio/deviceId', 'Input device', 'audio', 'default', ['default']),
  F('audio/gain', 'Input gain', 'audio', 1, 0, 4),
  I('audio/lowCross', 'Low/mid crossover Hz', 'audio', 150, 60, 500),
  I('audio/midCross', 'Mid/high crossover Hz', 'audio', 2000, 500, 6000),
  F('audio/lowBoost', 'Low band boost', 'audio', 1.5, 0.5, 6),
  F('audio/midBoost', 'Mid band boost', 'audio', 2.2, 0.5, 6),
  F('audio/highBoost', 'High band boost', 'audio', 3.2, 0.5, 6),
  F('audio/attack', 'Band attack', 'audio', 0.5, 0.01, 1),
  F('audio/release', 'Band release', 'audio', 0.08, 0.01, 1),
  F('audio/beatSensitivity', 'Beat sensitivity', 'audio', 1.4, 1, 3),
  B('audio/beatMonitor', 'Beat monitor on projector output', 'audio', false),
  F('audio/manualBpm', 'Manual BPM', 'audio', 128, 60, 200, 0.5),
  B('audio/useManualBpm', 'MANUAL BPM (overrides detection)', 'audio', true),
  T('audio/tapTempo', 'Tap tempo', 'audio'),
  // audio file playback (uploaded from the control panel for tuning)
  B('audio/fileLoop', 'Loop audio file', 'audio', true),
  F('audio/fileVolume', 'File monitor volume', 'audio', 0.9, 0, 1),
  T('audio/fileStop', 'Stop file → live input', 'audio'),

  // ---- phases ----
  // Master switch: off = the scheduler contributes nothing; only manual
  // per-effect overrides run. This is tuning mode.
  B('phases/enabled', 'PHASES (off = manual tuning)', 'phases', true),
  F('phases/chaos', 'CHAOS', 'phases', 0.5, 0, 1),
  I('phases/durationBars', 'Phase duration bars', 'phases', 6, 1, 64),
  I('phases/minEffects', 'Effects per phase min', 'phases', 2, 1, 6),
  I('phases/maxEffects', 'Effects per phase max', 'phases', 5, 1, 8),
  F('phases/crossfadeBeats', 'Crossfade beats', 'phases', 6, 1, 32, 1),
  T('phases/next', 'Force next phase', 'phases'),
  B('phases/freeze', 'Freeze phase', 'phases', false),

  // ---- post ----
  F('post/rgbSplit', 'RGB split', 'post', 0, 0, 1),
  F('post/feedbackDecay', 'Feedback trails', 'post', 0, 0, 0.97),
  F('post/displacement', 'Displacement', 'post', 0, 0, 1),
  F('post/scanlines', 'Scanlines', 'post', 0, 0, 1),
  F('post/noise', 'Grain', 'post', 0, 0, 1),
  F('post/bloomish', 'Bloom-ish', 'post', 0, 0, 1),
  B('post/enabled', 'Post enabled', 'post', true),

  // ---- data ----
  T('data/injectRandom', 'Inject random sentence', 'data'),

  // ---- per-effect knobs ----
  // typewriter
  F('fx/typewriter/intensity', 'Intensity override', 'fx: typewriter', -1, -1, 1),
  F('fx/typewriter/speed', 'Chars per sec', 'fx: typewriter', 24, 2, 120, 1),
  B('fx/typewriter/beatAdvance', 'Beat advances chunks', 'fx: typewriter', true),
  // wordBoxHighlight
  F('fx/wordBoxHighlight/intensity', 'Intensity override', 'fx: wordBoxHighlight', -1, -1, 1),
  I('fx/wordBoxHighlight/count', 'Words per box', 'fx: wordBoxHighlight', 1, 1, 4),
  F('fx/wordBoxHighlight/holdTime', 'Hold secs', 'fx: wordBoxHighlight', 0.6, 0.05, 3),
  E('fx/wordBoxHighlight/color', 'Highlight color', 'fx: wordBoxHighlight', '#ff2a6d', [
    '#ff2a6d',
    '#05d9e8',
    '#d1f7ff',
    '#f9f002',
    '#ffffff',
  ]),
  // wordColor
  F('fx/wordColor/intensity', 'Intensity override', 'fx: wordColor', -1, -1, 1),
  E('fx/wordColor/palette', 'Palette', 'fx: wordColor', 'neon', ['neon', 'acid', 'ice', 'blood']),
  F('fx/wordColor/flickerRate', 'Flicker rate', 'fx: wordColor', 0.65, 0, 1),
  // sizePulse
  F('fx/sizePulse/intensity', 'Intensity override', 'fx: sizePulse', -1, -1, 1),
  F('fx/sizePulse/depth', 'Pulse depth', 'fx: sizePulse', 0.25, 0, 0.6),
  // letterSpacingDrift
  F('fx/letterSpacingDrift/intensity', 'Intensity override', 'fx: letterSpacingDrift', -1, -1, 1),
  F('fx/letterSpacingDrift/amount', 'Drift amount', 'fx: letterSpacingDrift', 0.5, 0, 1),
  F('fx/letterSpacingDrift/rate', 'Drift rate', 'fx: letterSpacingDrift', 0.4, 0.05, 3),
  // justifyShift
  F('fx/justifyShift/intensity', 'Intensity override', 'fx: justifyShift', -1, -1, 1),
  B('fx/justifyShift/onBeat', 'Snap on beat', 'fx: justifyShift', true),
  F('fx/justifyShift/interval', 'Interval secs', 'fx: justifyShift', 1.5, 0.2, 8),
  // flashInOut
  F('fx/flashInOut/intensity', 'Intensity override', 'fx: flashInOut', -1, -1, 1),
  F('fx/flashInOut/probability', 'Probability', 'fx: flashInOut', 0.4, 0, 1),
  F('fx/flashInOut/rate', 'Rate', 'fx: flashInOut', 0.5, 0.05, 4),
  // caseFlip
  F('fx/caseFlip/intensity', 'Intensity override', 'fx: caseFlip', -1, -1, 1),
  F('fx/caseFlip/rate', 'Flip rate', 'fx: caseFlip', 0.15, 0.02, 1),
  // scramble
  F('fx/scramble/intensity', 'Intensity override', 'fx: scramble', -1, -1, 1),
  F('fx/scramble/rate', 'Scramble rate', 'fx: scramble', 0.6, 0.05, 2),
  F('fx/scramble/resolveTime', 'Resolve secs', 'fx: scramble', 1.2, 0.2, 5),
  // ghostEcho
  F('fx/ghostEcho/intensity', 'Intensity override', 'fx: ghostEcho', -1, -1, 1),
  I('fx/ghostEcho/copies', 'Copies', 'fx: ghostEcho', 2, 1, 3),
  F('fx/ghostEcho/offset', 'Max offset px', 'fx: ghostEcho', 14, 2, 60, 1),
  // similarWords
  F('fx/similarWords/intensity', 'Intensity override', 'fx: similarWords', -1, -1, 1),
  F('fx/similarWords/interval', 'Fire interval secs', 'fx: similarWords', 6, 1, 30),
  F('fx/similarWords/flashDur', 'Flash secs', 'fx: similarWords', 1.6, 0.3, 5),
  // layoutReshuffle
  F('fx/layoutReshuffle/intensity', 'Intensity override', 'fx: layoutReshuffle', -1, -1, 1),
  F('fx/layoutReshuffle/baseInterval', 'Base interval secs', 'fx: layoutReshuffle', 22, 5, 180, 1),
  F('fx/layoutReshuffle/fullProb', 'Full rebuild prob', 'fx: layoutReshuffle', 0.3, 0, 1),
  // gridBreathe
  F('fx/gridBreathe/intensity', 'Intensity override', 'fx: gridBreathe', -1, -1, 1),
  F('fx/gridBreathe/amount', 'Breathe amount', 'fx: gridBreathe', 0.35, 0, 1),
  // spotlight
  F('fx/spotlight/intensity', 'Intensity override', 'fx: spotlight', -1, -1, 1),
  F('fx/spotlight/holdSecs', 'Hold per box secs', 'fx: spotlight', 2.5, 0.5, 10),
  F('fx/spotlight/dimAmount', 'Dim others', 'fx: spotlight', 0.7, 0, 1),
  // cascade
  F('fx/cascade/intensity', 'Intensity override', 'fx: cascade', -1, -1, 1),
  F('fx/cascade/perBoxDelay', 'Per-box delay secs', 'fx: cascade', 0.12, 0.02, 0.8),
  // asciiCamera
  F('fx/asciiCamera/intensity', 'Intensity override', 'fx: asciiCamera', -1, -1, 1),
  I('fx/asciiCamera/cellSize', 'Cell size px', 'fx: asciiCamera', 14, 6, 40),
  B('fx/asciiCamera/useSentences', 'Text becomes the ascii', 'fx: asciiCamera', true),
  F('fx/asciiCamera/fadeText', 'Fade boxes into ascii', 'fx: asciiCamera', 0.9, 0, 1),
  F('fx/asciiCamera/flowSpeed', 'Text flow chars/sec', 'fx: asciiCamera', 6, 0, 40, 1),
  F('fx/asciiCamera/threshold', 'Luminance threshold', 'fx: asciiCamera', 0.13, 0, 0.5),
  // Bright defaults: in sentence mode the ascii IS the foreground.
  E('fx/asciiCamera/tint', 'Tint', 'fx: asciiCamera', '#9fe8cf', [
    '#9fe8cf',
    '#d1f7ff',
    '#f9f002',
    '#ff2a6d',
    '#ffffff',
    '#2a5a4a',
  ]),
  // strobeInvert (photosensitivity: hard clamp at 4 flashes/sec)
  F('fx/strobeInvert/intensity', 'Intensity override', 'fx: strobeInvert', -1, -1, 1),
  F('fx/strobeInvert/maxRate', 'Max flashes/sec', 'fx: strobeInvert', 2, 0.5, 4),
];

/** Every effect id — used to generate per-effect enable switches and by the
 *  control panel's FX mixer. Must match src/effects/registry.ts. */
export const FX_IDS = [
  'typewriter',
  'wordBoxHighlight',
  'wordColor',
  'sizePulse',
  'letterSpacingDrift',
  'justifyShift',
  'flashInOut',
  'caseFlip',
  'scramble',
  'ghostEcho',
  'similarWords',
  'layoutReshuffle',
  'gridBreathe',
  'spotlight',
  'cascade',
  'asciiCamera',
  'strobeInvert',
] as const;

for (const id of FX_IDS) {
  PARAM_DEFS.push(B(`fx/${id}/enabled`, 'Enabled', `fx: ${id}`, true));
}
