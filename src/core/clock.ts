// Beat/bar clock with two strict modes:
//  - MANUAL (audio/useManualBpm on): grid runs at the manual BPM, detection
//    is ignored entirely.
//  - AUTO (off): beats fire only on DETECTED beats; tempo is estimated from
//    detected intervals (falling back to a neutral 120 until beats arrive).
//    The manual BPM param is completely out of the loop.

import type { ParamStore } from './params';

const BEATS_PER_BAR = 4;
const DEFAULT_AUTO_BPM = 120; // neutral grid tempo before any detection lands

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
    if (this.params.bool('audio/useManualBpm')) {
      return this.params.num('audio/manualBpm');
    }
    // Auto mode: manual BPM is disabled — detection or the neutral default.
    return this.detectedBpm > 0 ? this.detectedBpm : DEFAULT_AUTO_BPM;
  }

  get beatDuration(): number {
    return 60 / this.bpm;
  }

  get barDuration(): number {
    return this.beatDuration * BEATS_PER_BAR;
  }

  private detectedThisFrame = false;

  /** Called by the audio analyser when it detects a beat. */
  reportDetectedBeat(time: number): void {
    // Manual BPM is a hard override: detection must not re-anchor the beat
    // grid or feed the detected tempo while the switch is on.
    if (this.params.bool('audio/useManualBpm')) return;
    this.detectedThisFrame = true;
    if (this.lastBeatTime > 0) {
      const interval = time - this.lastBeatTime;
      if (interval > 0.25 && interval < 1.2) {
        this.beatIntervals.push(interval);
        if (this.beatIntervals.length > 16) this.beatIntervals.shift();
        if (this.beatIntervals.length >= 4) {
          const sorted = [...this.beatIntervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          // Real-music detectors are noisy — accept when half the intervals
          // sit near the median.
          const near = this.beatIntervals.filter((i) => Math.abs(i - median) < 0.06).length;
          if (near >= this.beatIntervals.length * 0.5) {
            this.detectedBpm = 60 / median;
          }
        }
      }
    }
    // Re-anchor the grid PHASE to the detected kick while preserving the
    // accumulated beat count — bars must keep advancing or the phase
    // scheduler freezes in auto mode.
    const nearest = Math.round(this.beatPosition);
    this.phaseOrigin = time - nearest * this.beatDuration;
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
    if (this.params.bool('audio/useManualBpm')) {
      // Manual: beats fire on grid crossings, metronome-style.
      this.beatThisFrame = Math.floor(this.beatPosition) > Math.floor(prev);
    } else {
      // Auto: beats fire ONLY on actually detected beats — silence = no beats.
      this.beatThisFrame = this.detectedThisFrame;
      this.detectedThisFrame = false;
    }
  }

  get barPosition(): number {
    return this.beatPosition / BEATS_PER_BAR;
  }
}
