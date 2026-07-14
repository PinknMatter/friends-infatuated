// Phase scheduler: generates phases (2–4 effects + post-uniform targets),
// crossfades intensities over N beats, all scaled by the CHAOS fader.
//
// Post targets are scheduler-internal (postDrive) and combined with the manual
// post params by the renderer via max() — driving params.set every frame would
// spam the transport.

import type { ParamStore } from '../core/params';
import type { Clock } from '../core/clock';
import { RNG } from '../core/rng';
import { EFFECTS, effectById, selectionWeight } from '../effects/registry';
import type { EffectCtx } from '../effects/types';
import { applyScene, pickScene } from './scenes';

const POST_KEYS = ['rgbSplit', 'feedbackDecay', 'displacement', 'scanlines', 'noise', 'bloomish'] as const;
const POST_CEILING: Record<(typeof POST_KEYS)[number], number> = {
  rgbSplit: 0.85,
  feedbackDecay: 0.95,
  displacement: 0.75,
  scanlines: 0.85,
  noise: 0.7,
  bloomish: 0.85,
};

interface Phase {
  effects: Map<string, number>; // id → target intensity
  post: Partial<Record<(typeof POST_KEYS)[number], number>>;
  startedAtBar: number;
  durationBars: number;
  index: number;
}

export class PhaseScheduler {
  private params: ParamStore;
  private clock: Clock;
  private rootRng: RNG;
  /** Per-phase deterministic RNG, handed to effects via ctx. */
  phaseRng: RNG;

  private current: Phase;
  private previous: Phase | null = null;
  private crossfadeStartBeat = 0;
  private phaseCounter = 0;
  private currentIntensities = new Map<string, number>();
  private postDrive: Record<string, number> = {};
  private sceneName = 'poster';
  private sceneStartBar = 0;

  constructor(params: ParamStore, clock: Clock) {
    this.params = params;
    this.clock = clock;
    this.rootRng = new RNG(params.num('master/seed'));
    this.phaseRng = this.rootRng.fork();
    this.current = this.generatePhase(0);
    params.onChange('phases/next', () => this.forceNext());
    params.onChange('phases/nextScene', () => this.switchScene(true));
    params.onChange('master/seed', (v) => {
      this.rootRng = new RNG(Number(v));
    });
    if (params.bool('phases/scenesEnabled')) this.switchScene(true);
  }

  /** Generative layout scenes: retarget the layout params + rebuild. */
  private switchScene(force = false): void {
    if (!force && !this.params.bool('phases/scenesEnabled')) return;
    const chaos = this.params.num('phases/chaos');
    const rng = this.rootRng.fork();
    const scene = pickScene(rng, chaos, this.sceneName);
    this.sceneName = scene.name;
    this.sceneStartBar = this.clock.barPosition;
    applyScene(scene, rng, this.params);
  }

  private generatePhase(startBar: number): Phase {
    const chaos = this.params.num('phases/chaos');
    const rng = this.rootRng.fork();
    this.phaseRng = this.rootRng.fork();

    const minFx = this.params.num('phases/minEffects');
    const maxFx = Math.max(minFx, this.params.num('phases/maxEffects'));
    // Effect count scales with chaos inside the min/max window.
    const count = Math.round(minFx + (maxFx - minFx) * Math.min(1, chaos + rng.range(-0.15, 0.15)));

    const chosen = new Map<string, number>();
    const excluded = new Set<string>();
    const candidates = EFFECTS.map((e) => e.id);

    let guard = 0;
    while (chosen.size < count && guard++ < 200) {
      // Weighted pick.
      const weights = candidates.map((id) =>
        chosen.has(id) || excluded.has(id) ? 0 : selectionWeight(id, chaos),
      );
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) break;
      let roll = rng.next() * total;
      let picked = '';
      for (let i = 0; i < candidates.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          picked = candidates[i];
          break;
        }
      }
      if (!picked) break;

      const effect = effectById.get(picked)!;
      // Respect incompatibilities in both directions.
      const conflict = [...chosen.keys()].some(
        (id) =>
          effectById.get(id)!.incompatibleWith?.includes(picked) ||
          effect.incompatibleWith?.includes(id),
      );
      if (conflict) {
        excluded.add(picked);
        continue;
      }
      // Intensity ceiling rises with chaos.
      const ceiling = Math.min(1, 0.65 + 0.5 * chaos);
      chosen.set(picked, rng.range(0.5, ceiling));
    }

    // Post-uniform targets: more (and hotter) as chaos rises.
    const post: Phase['post'] = {};
    for (const key of POST_KEYS) {
      if (rng.chance(0.2 + chaos * 0.6)) {
        post[key] = rng.range(0.12, POST_CEILING[key] * Math.min(1, 0.25 + chaos));
      }
    }

    const durBars = this.params.num('phases/durationBars');
    const jitter = rng.range(0.75, 1.35);
    return {
      effects: chosen,
      post,
      startedAtBar: startBar,
      durationBars: Math.max(1, durBars * jitter),
      index: this.phaseCounter++,
    };
  }

  private forceNext(): void {
    this.advance();
  }

  private advance(): void {
    this.previous = this.current;
    this.current = this.generatePhase(this.clock.barPosition);
    this.crossfadeStartBeat = this.clock.beatPosition;
    if (this.lastCtx) {
      for (const id of this.current.effects.keys()) {
        effectById.get(id)?.onPhaseEnter?.(this.lastCtx);
      }
    }
    // Maybe roll into a new layout scene alongside the new phase.
    if (
      this.params.bool('phases/scenesEnabled') &&
      this.clock.barPosition - this.sceneStartBar >= this.params.num('phases/sceneMinBars') &&
      this.rootRng.chance(this.params.num('phases/sceneSwitchProb'))
    ) {
      this.switchScene();
    }
  }

  private lastCtx: EffectCtx | null = null;

  /** Advance phase state; call once per frame before effects run. */
  update(ctx: EffectCtx): void {
    this.lastCtx = ctx;
    // phases/enabled off = manual tuning mode: the scheduler contributes
    // nothing; only fx/<id>/intensity overrides drive effects.
    const enabled = this.params.bool('phases/enabled');
    const frozen = this.params.bool('phases/freeze') || !enabled;

    if (!frozen) {
      const elapsed = this.clock.barPosition - this.current.startedAtBar;
      if (elapsed >= this.current.durationBars) this.advance();
    }

    // Crossfade current intensities toward targets over N beats.
    const fadeBeats = Math.max(0.5, this.params.num('phases/crossfadeBeats'));
    const chaos = this.params.num('phases/chaos');
    // Chaos speeds transitions up.
    const fadeT = Math.min(
      1,
      (this.clock.beatPosition - this.crossfadeStartBeat) / (fadeBeats * (1 - chaos * 0.5)),
    );

    // Solo handling: while a wantsSolo effect fires, others duck.
    const soloing = EFFECTS.some(
      (e) => e.wantsSolo && e.soloActive && this.current.effects.has(e.id),
    );

    this.currentIntensities.clear();
    for (const effect of EFFECTS) {
      const from = this.previous?.effects.get(effect.id) ?? 0;
      const to = this.current.effects.get(effect.id) ?? 0;
      let intensity = enabled ? from + (to - from) * fadeT : 0;

      // Manual override wins over the scheduler until cleared (set back to -1).
      const override = this.params.num(`fx/${effect.id}/intensity`);
      if (override >= 0) intensity = override;

      // Hard per-effect kill switch — beats scheduler AND override.
      if (!this.params.bool(`fx/${effect.id}/enabled`)) intensity = 0;

      if (soloing && effect.wantsSolo !== true && intensity > 0) {
        intensity *= 0.25;
      }
      if (intensity > 0.001) this.currentIntensities.set(effect.id, intensity);
    }

    // Post drive crossfades the same way (silent in manual tuning mode).
    for (const key of POST_KEYS) {
      const from = this.previous?.post[key] ?? 0;
      const to = this.current.post[key] ?? 0;
      this.postDrive[key] = enabled ? from + (to - from) * fadeT : 0;
    }
  }

  intensityOf(id: string): number {
    return this.currentIntensities.get(id) ?? 0;
  }

  activeEffects(): { id: string; intensity: number }[] {
    return [...this.currentIntensities.entries()].map(([id, intensity]) => ({ id, intensity }));
  }

  /** Scheduler contribution to a post uniform; renderer max()es with the param. */
  postDriveOf(key: string): number {
    return this.postDrive[key] ?? 0;
  }

  get phaseName(): string {
    return `#${this.current.index} · ${this.sceneName}`;
  }
}
