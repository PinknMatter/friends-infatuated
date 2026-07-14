// Raw Web Audio input analysis: device selection, FFT, band energies with
// attack/release smoothing, and low-band beat detection vs a rolling average.
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
  private freqData: Uint8Array = new Uint8Array(FFT_SIZE / 2);

  private smoothed = { low: 0, mid: 0, high: 0, energy: 0 };
  private lowHistory: number[] = [];
  private lastBeatAt = -10;
  private detectedBeatThisFrame = false;

  status: 'idle' | 'running' | 'denied' | 'error' = 'idle';

  constructor(params: ParamStore, clock: Clock) {
    this.params = params;
    this.clock = clock;
    params.onChange('audio/deviceId', () => {
      if (this.status === 'running') void this.start();
    });
    params.onChange('audio/gain', (v) => {
      if (this.gainNode) this.gainNode.gain.value = Number(v);
    });
  }

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
      this.stop();
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.ctx = this.ctx ?? new AudioContext();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.params.num('audio/gain');
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0; // we smooth ourselves
      source.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.status = 'running';
    } catch (err) {
      this.status = err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error';
      console.warn('[audio] start failed:', err);
    }
  }

  private stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
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

      const raw = {
        low: band(20, lowCross),
        mid: band(lowCross, midCross),
        high: band(midCross, 10000),
      };
      const energy = (raw.low + raw.mid + raw.high) / 3;

      // Attack/release smoothing (frame-rate compensated).
      const attack = 1 - Math.exp(-dt * 60 * this.params.num('audio/attack'));
      const release = 1 - Math.exp(-dt * 60 * this.params.num('audio/release'));
      const smooth = (cur: number, target: number) =>
        cur + (target - cur) * (target > cur ? attack : release);
      this.smoothed.low = smooth(this.smoothed.low, raw.low);
      this.smoothed.mid = smooth(this.smoothed.mid, raw.mid);
      this.smoothed.high = smooth(this.smoothed.high, raw.high);
      this.smoothed.energy = smooth(this.smoothed.energy, energy);

      // Beat detect: instantaneous low vs rolling average.
      this.lowHistory.push(raw.low);
      if (this.lowHistory.length > HISTORY_LEN) this.lowHistory.shift();
      const avg = this.lowHistory.reduce((a, b) => a + b, 0) / this.lowHistory.length;
      const sensitivity = this.params.num('audio/beatSensitivity');
      if (
        raw.low > avg * sensitivity &&
        raw.low > 0.08 &&
        time - this.lastBeatAt > BEAT_REFRACTORY
      ) {
        this.lastBeatAt = time;
        this.detectedBeatThisFrame = true;
        this.clock.reportDetectedBeat(time);
      }
    }

    return {
      bands: { low: this.smoothed.low, mid: this.smoothed.mid, high: this.smoothed.high },
      beat: this.clock.beatThisFrame,
      energy: this.smoothed.energy,
    };
  }

  get detectedBeat(): boolean {
    return this.detectedBeatThisFrame;
  }
}
