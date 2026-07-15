// Raw Web Audio input analysis: device selection, FFT, band energies with
// attack/release smoothing, and low-band beat detection vs a rolling average.
// Sources: live input (mic/line-in) or an uploaded audio file — both feed the
// same gain → analyser chain, so beat detect and bands behave identically.
// No p5.sound.

import type { ParamStore } from '../core/params';
import type { Clock } from '../core/clock';
import type { AudioFrame } from '../effects/types';

const FFT_SIZE = 2048;
const BEAT_REFRACTORY = 0.25; // secs
const HISTORY_LEN = 43; // ~0.7s of frames for the rolling average

export class AudioAnalyser {
  private params: ParamStore;
  private clock: Clock;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private fileSource: AudioBufferSourceNode | null = null;
  private fileMonitorGain: GainNode | null = null;
  private freqData: Uint8Array = new Uint8Array(FFT_SIZE / 2);

  private smoothed = { low: 0, mid: 0, high: 0, energy: 0 };
  private lastBeatAt = -10;
  private detectedBeatThisFrame = false;
  // Spectral-flux onset detection: frame-to-frame positive spectral change,
  // normalized by recent spectral energy — level-independent (works at any
  // input gain) and robust on heavily compressed material.
  private prevSpec = new Uint8Array(FFT_SIZE / 2);
  private fluxHistory: number[] = [];
  // Adaptive per-band range tracking (auto-gain): loud sustained music pins
  // absolute levels near max — effects need the RELATIVE motion.
  private bandStats: Record<'low' | 'mid' | 'high', { floor: number; peak: number }> = {
    low: { floor: 0, peak: 0.25 },
    mid: { floor: 0, peak: 0.25 },
    high: { floor: 0, peak: 0.25 },
  };

  mode: 'mic' | 'file' = 'mic';
  status: string = 'idle';

  /** Live detection internals for the on-screen beat monitor. */
  monitor = { rawLow: 0, avg: 0, threshold: 0 };

  constructor(params: ParamStore, clock: Clock) {
    this.params = params;
    this.clock = clock;
    params.onChange('audio/deviceId', () => {
      if (this.mode === 'mic' && this.status === 'running') void this.start();
    });
    params.onChange('audio/gain', (v) => {
      if (this.gainNode) this.gainNode.gain.value = Number(v);
    });
    params.onChange('audio/fileLoop', (v) => {
      if (this.fileSource) this.fileSource.loop = Boolean(v);
    });
    params.onChange('audio/fileVolume', (v) => {
      if (this.fileMonitorGain) this.fileMonitorGain.gain.value = Number(v);
    });
    params.onChange('audio/fileStop', () => {
      if (this.mode === 'file') {
        this.stopFile();
        void this.start();
      }
    });
  }

  /** Shared gain → analyser graph; both sources plug into gainNode. */
  private ensureGraph(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (!this.gainNode || !this.analyser) {
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.params.num('audio/gain');
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0; // we smooth ourselves
      this.gainNode.connect(this.analyser);
      // NOTE: gainNode never connects to destination — mic would feed back.
    }
  }

  /** Start (or restart) live input capture. */
  async start(): Promise<void> {
    try {
      const deviceId = this.params.str('audio/deviceId');
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };
      this.stopMic();
      this.stopFile();
      this.ensureGraph();
      if (this.ctx!.state === 'suspended') await this.ctx!.resume();
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micSource = this.ctx!.createMediaStreamSource(this.stream);
      this.micSource.connect(this.gainNode!);
      this.mode = 'mic';
      this.status = 'running';
    } catch (err) {
      this.status =
        err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error';
      console.warn('[audio] start failed:', err);
    }
  }

  /** Decode and play an uploaded file; it replaces the mic as analysis source
   *  and is also routed to the speakers for monitoring. */
  async playFile(buffer: ArrayBuffer, name: string): Promise<void> {
    try {
      this.ensureGraph();
      if (this.ctx!.state === 'suspended') {
        await this.ctx!.resume(); // needs a prior user gesture in the render window
      }
      const audioBuf = await this.ctx!.decodeAudioData(buffer);
      this.stopMic();
      this.stopFile();

      this.fileSource = this.ctx!.createBufferSource();
      this.fileSource.buffer = audioBuf;
      this.fileSource.loop = this.params.bool('audio/fileLoop');
      this.fileSource.connect(this.gainNode!); // analysis path

      this.fileMonitorGain = this.ctx!.createGain();
      this.fileMonitorGain.gain.value = this.params.num('audio/fileVolume');
      this.fileSource.connect(this.fileMonitorGain);
      this.fileMonitorGain.connect(this.ctx!.destination); // monitor path

      this.fileSource.onended = () => {
        // Non-looping file ran out → fall back to live input.
        if (this.mode === 'file' && this.fileSource && !this.fileSource.loop) {
          this.stopFile();
          void this.start();
        }
      };

      this.fileSource.start();
      this.mode = 'file';
      this.status = `file: ${name}`;
    } catch (err) {
      this.status = 'error';
      console.warn('[audio] playFile failed:', err);
      throw err;
    }
  }

  private stopMic(): void {
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  private stopFile(): void {
    if (this.fileSource) {
      this.fileSource.onended = null;
      try {
        this.fileSource.stop();
      } catch {
        /* already stopped */
      }
      this.fileSource.disconnect();
      this.fileSource = null;
    }
    if (this.fileMonitorGain) {
      this.fileMonitorGain.disconnect();
      this.fileMonitorGain = null;
    }
    this.mode = 'mic';
  }

  /** Sample the FFT and produce this frame's AudioFrame. Call once per frame. */
  update(time: number, dt: number): AudioFrame {
    this.detectedBeatThisFrame = false;

    if (this.analyser && this.ctx) {
      this.analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
      const nyquist = this.ctx.sampleRate / 2;
      const binHz = nyquist / this.freqData.length;
      const lowCross = this.params.num('audio/lowCross');
      const midCross = this.params.num('audio/midCross');

      const band = (fromHz: number, toHz: number): number => {
        const from = Math.max(0, Math.floor(fromHz / binHz));
        const to = Math.min(this.freqData.length - 1, Math.ceil(toHz / binHz));
        let sum = 0;
        for (let i = from; i <= to; i++) sum += this.freqData[i];
        return to >= from ? sum / ((to - from + 1) * 255) : 0;
      };

      // Spectra tilt heavily toward bass — without makeup gain the mid/high
      // bands barely move and effects riding them look dead. NOT clamped here:
      // clamping before auto-gain pins loud bands flat at 1.0 and destroys
      // the variation normalization needs.
      const raw = {
        low: band(20, lowCross) * this.params.num('audio/lowBoost'),
        mid: band(lowCross, midCross) * this.params.num('audio/midBoost'),
        high: band(midCross, 10000) * this.params.num('audio/highBoost'),
      };

      // Auto-gain: map each band into its own recent floor..peak range so
      // effects see the music's MOVEMENT even when the absolute level is
      // pinned loud all night.
      const autoGain = this.params.bool('audio/autoGain');
      const norm = (name: 'low' | 'mid' | 'high', value: number): number => {
        if (!autoGain) return Math.min(1, value);
        const s = this.bandStats[name];
        s.peak = Math.max(value, s.peak * Math.exp(-dt / 8)); // fast up, ~8s decay
        s.floor = Math.min(
          s.floor + (value - s.floor) * Math.min(1, dt / 10),
          value,
          // Cap the floor below the peak so compressed pinned-loud music
          // reads ~1 instead of collapsing the range to zero.
          s.peak * 0.55,
        );
        const range = Math.max(0.04, s.peak - s.floor);
        return Math.min(1, Math.max(0, (value - s.floor) / range));
      };
      const rel = {
        low: norm('low', raw.low),
        mid: norm('mid', raw.mid),
        high: norm('high', raw.high),
      };
      const energy = (rel.low + rel.mid + rel.high) / 3;

      // Attack/release smoothing (frame-rate compensated).
      const attack = 1 - Math.exp(-dt * 60 * this.params.num('audio/attack'));
      const release = 1 - Math.exp(-dt * 60 * this.params.num('audio/release'));
      const smooth = (cur: number, target: number) =>
        cur + (target - cur) * (target > cur ? attack : release);
      this.smoothed.low = smooth(this.smoothed.low, rel.low);
      this.smoothed.mid = smooth(this.smoothed.mid, rel.mid);
      this.smoothed.high = smooth(this.smoothed.high, rel.high);
      this.smoothed.energy = smooth(this.smoothed.energy, energy);

      // Beat detect: spectral flux (positive frame-to-frame change, 20Hz–4kHz,
      // weighted toward the low end) NORMALIZED by current spectral energy —
      // input gain cancels out entirely.
      const fluxBins = Math.min(this.freqData.length, Math.ceil(4000 / binHz));
      const lowBins = Math.max(1, Math.floor(lowCross / binHz));
      let flux = 0;
      let specEnergy = 0;
      for (let i = 0; i < fluxBins; i++) {
        const weight = i <= lowBins ? 3 : 1; // kicks live down here
        flux += Math.max(0, this.freqData[i] - this.prevSpec[i]) * weight;
        specEnergy += this.freqData[i] * weight;
      }
      this.prevSpec.set(this.freqData.subarray(0, fluxBins));
      // Relative flux: fraction of current spectral energy that is NEW.
      const relFlux = specEnergy > fluxBins * 2 ? flux / specEnergy : 0;

      this.fluxHistory.push(relFlux);
      if (this.fluxHistory.length > HISTORY_LEN) this.fluxHistory.shift();
      const avg = this.fluxHistory.reduce((a, b) => a + b, 0) / this.fluxHistory.length;
      const sensitivity = this.params.num('audio/beatSensitivity');
      this.monitor.rawLow = relFlux;
      this.monitor.avg = avg;
      this.monitor.threshold = avg * sensitivity + 0.01;
      if (relFlux > this.monitor.threshold && time - this.lastBeatAt > BEAT_REFRACTORY) {
        this.lastBeatAt = time;
        this.detectedBeatThisFrame = true;
        this.clock.reportDetectedBeat(time);
      }
    }

    return {
      bands: { low: this.smoothed.low, mid: this.smoothed.mid, high: this.smoothed.high },
      beat: this.clock.beatThisFrame,
      beatPos: this.clock.beatPosition,
      bpm: this.clock.bpm,
      energy: this.smoothed.energy,
      drive: 1, // renderer computes and overwrites (needs slow-smoothed state)
    };
  }

  get detectedBeat(): boolean {
    return this.detectedBeatThisFrame;
  }
}
