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
  private smoothedBpm = 0; // eased manual tempo (gradual slider takeover)
  private lastUpdateTime = -1;

  /** Total beats elapsed (float). */
  beatPosition = 0;
  /** True only on the frame a beat boundary was crossed. */
  beatThisFrame = false;

  constructor(params: ParamStore) {
    this.params = params;
    params.onChange('audio/tapTempo', () => this.tap());
    // Mode switches must not rescale elapsed time: re-anchor so the beat
    // COUNT carries over (manual→auto with differing tempos leapt barPosition
    // and skipped phases — real user-reported bug).
    params.onChange('audio/useManualBpm', () => {
      if (this.lastUpdateTime < 0) return;
      this.phaseOrigin = this.lastUpdateTime - this.beatPosition * this.beatDuration;
    });
  }

  get bpm(): number {
    if (this.params.bool('audio/useManualBpm')) {
      // The EASED tempo, not the raw param — the grid (and everything shown)
      // glides toward the slider instead of jumping.
      return this.smoothedBpm > 0 ? this.smoothedBpm : this.params.num('audio/manualBpm');
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

  /** Detected-tempo estimate and its confidence (0..1) — always maintained,
   *  even in manual mode, so the panel can show what analysis is finding. */
  get detectedTempo(): { bpm: number; confidence: number } {
    return { bpm: this.detectedBpm, confidence: this.tempoConfidence };
  }
  private tempoConfidence = 0;

  /** Called by the audio analyser when it detects a beat. */
  reportDetectedBeat(time: number): void {
    // Tempo ESTIMATION always runs (so the panel can display it), but in
    // manual mode it must not touch the beat grid.
    const manual = this.params.bool('audio/useManualBpm');
    if (!manual) this.detectedThisFrame = true;

    if (this.lastBeatTime > 0) {
      let interval = time - this.lastBeatTime;
      if (interval > 0.2 && interval < 2.5) {
        // Octave-fold into 70–180 BPM so missed/double-fired beats still
        // vote for the same underlying tempo.
        while (interval < 60 / 180) interval *= 2;
        while (interval > 60 / 70) interval /= 2;
        this.beatIntervals.push(interval);
        if (this.beatIntervals.length > 24) this.beatIntervals.shift();

        if (this.beatIntervals.length >= 6) {
          // Cluster: the interval with the most neighbours within 30ms wins.
          let bestCenter = 0;
          let bestCount = 0;
          for (const candidate of this.beatIntervals) {
            const cluster = this.beatIntervals.filter((i) => Math.abs(i - candidate) < 0.03);
            if (cluster.length > bestCount) {
              bestCount = cluster.length;
              bestCenter = cluster.reduce((a, b) => a + b, 0) / cluster.length;
            }
          }
          this.tempoConfidence = bestCount / this.beatIntervals.length;
          if (this.tempoConfidence >= 0.4 && bestCenter > 0) {
            this.detectedBpm = 60 / bestCenter;
          }
        }
      }
    }
    if (!manual) {
      // Re-anchor the grid PHASE to the detected kick while preserving the
      // accumulated beat count — bars must keep advancing or the phase
      // scheduler freezes in auto mode.
      const nearest = Math.round(this.beatPosition);
      this.phaseOrigin = time - nearest * this.beatDuration;
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
      // Snap the nearest beat boundary to the tap while PRESERVING the
      // accumulated beat count — resetting the origin to now yanked
      // barPosition back to 0 and stalled the phase scheduler.
      this.beatPosition = Math.round(this.beatPosition);
      this.phaseOrigin = now - this.beatPosition * this.beatDuration;
    }
  }

  /** Advance the clock; call once per frame. */
  update(time: number): void {
    // dt clamp: after a hidden-tab rAF pause the grid resumes instead of
    // fast-forwarding hundreds of beats.
    const dt = this.lastUpdateTime >= 0 ? Math.min(time - this.lastUpdateTime, 0.25) : 0;
    this.lastUpdateTime = time;
    const prev = this.beatPosition;
    if (this.params.bool('audio/useManualBpm')) {
      // Gradual slider takeover: ease the effective tempo toward the param
      // and advance the grid INCREMENTALLY. Recomputing beatPosition from a
      // fixed origin rescales ALL elapsed time on any bpm change, so
      // barPosition leaps and the scheduler burns through phases (real
      // user-reported bug: riding the slider live made everything flash).
      const target = this.params.num('audio/manualBpm');
      const glide = this.params.num('audio/bpmGlideSecs');
      if (this.smoothedBpm <= 0 || glide < 0.05) {
        this.smoothedBpm = target;
      } else {
        this.smoothedBpm += (target - this.smoothedBpm) * (1 - Math.exp(-dt / glide));
        if (Math.abs(target - this.smoothedBpm) < 0.05) this.smoothedBpm = target;
      }
      this.beatPosition += dt / this.beatDuration;
      // Keep the origin coherent so mode switches land on a sane grid.
      this.phaseOrigin = time - this.beatPosition * this.beatDuration;
      // Manual: beats fire on grid crossings, metronome-style.
      this.beatThisFrame = Math.floor(this.beatPosition) > Math.floor(prev);
    } else {
      this.beatPosition = (time - this.phaseOrigin) / this.beatDuration;
      // Auto: beats fire ONLY on actually detected beats — silence = no beats.
      this.beatThisFrame = this.detectedThisFrame;
      this.detectedThisFrame = false;
    }
  }

  get barPosition(): number {
    return this.beatPosition / BEATS_PER_BAR;
  }
}
