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
  private lowHistory: number[] = [];
  private lastBeatAt = -10;
  private detectedBeatThisFrame = false;

  mode: 'mic' | 'file' = 'mic';
  status: string = 'idle';

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
