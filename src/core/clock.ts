// Beat/bar clock. Derives BPM from detected beats when confident;
// manual BPM + tap tempo is the (non-optional) fallback for messy rave audio.

import type { ParamStore } from './params';

const BEATS_PER_BAR = 4;

export class Clock {
  private params: ParamStore;
  private lastBeatTime = 0;
  private beatIntervals: number[] = []; // recent detected intervals (secs)
  private detectedBpm = 0;
  private tapTimes: number[] = [];
  private phaseOrigin = 0; // time of beat 0

  /** Total beats elapsed (float). */
  beatPosition = 0;
  /** True only on the frame a beat boundary was crossed. */
  beatThisFrame = false;

  constructor(params: ParamStore) {
    this.params = params;
    params.onChange('audio/tapTempo', () => this.tap());
  }

  get bpm(): number {
    if (this.params.bool('audio/useManualBpm') || this.detectedBpm === 0) {
      return this.params.num('audio/manualBpm');
    }
    return this.detectedBpm;
  }

  get beatDuration(): number {
    return 60 / this.bpm;
  }

  get barDuration(): number {
    return this.beatDuration * BEATS_PER_BAR;
  }

  /** Called by the audio analyser when it detects a beat. */
  reportDetectedBeat(time: number): void {
    // Manual BPM is a hard override: detection must not re-anchor the beat
    // grid or feed the detected tempo while the switch is on.
    if (this.params.bool('audio/useManualBpm')) return;
    if (this.lastBeatTime > 0) {
      const interval = time - this.lastBeatTime;
      if (interval > 0.25 && interval < 1.2) {
        this.beatIntervals.push(interval);
        if (this.beatIntervals.length > 16) this.beatIntervals.shift();
        if (this.beatIntervals.length >= 8) {
          const sorted = [...this.beatIntervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          // Confidence check: most intervals near the median.
          const near = this.beatIntervals.filter((i) => Math.abs(i - median) < 0.04).length;
          if (near >= this.beatIntervals.length * 0.6) {
            this.detectedBpm = 60 / median;
            this.phaseOrigin = time; // re-anchor beat grid to the detected beat
            this.beatPosition = Math.round(this.beatPosition);
          }
        }
      }
    }
    this.lastBeatTime = time;
  }

  private tap(): void {
    const now = performance.now() / 1000;
    this.tapTimes = this.tapTimes.filter((t) => now - t < 3);
    this.tapTimes.push(now);
    if (this.tapTimes.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < this.tapTimes.length; i++) {
        intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.min(200, Math.max(60, 60 / avg));
      this.params.set('audio/manualBpm', Math.round(bpm * 2) / 2);
      this.phaseOrigin = now;
    }
  }

  /** Advance the clock; call once per frame. */
  update(time: number): void {
    const prev = this.beatPosition;
    this.beatPosition = (time - this.phaseOrigin) / this.beatDuration;
    this.beatThisFrame = Math.floor(this.beatPosition) > Math.floor(prev);
  }

  get barPosition(): number {
    return this.beatPosition / BEATS_PER_BAR;
  }
}
