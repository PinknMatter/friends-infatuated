// Generative layout scenes: coherent bundles of layout-param targets the
// scheduler switches between over the night — sparse monoliths, posters,
// column grids, row stacks, dense walls of text. Values are sampled per
// switch so no two visits to an archetype look identical.
//
// Scenes drive the SAME params the control panel shows (params.set), so the
// sliders visibly follow, and turning scenes/enabled off freezes everything
// exactly where it is for hand-tuning.

import { RNG } from '../core/rng';
import type { ParamStore } from '../core/params';

export interface SceneDef {
  name: string;
  /** Selection weight as a function of chaos 0..1. */
  weight: (chaos: number) => number;
  /** Sampled layout-param targets. */
  gen(rng: RNG): Record<string, number>;
}

export const SCENES: SceneDef[] = [
  {
    // A few huge sentences — negative space, statement typography.
    name: 'monolith',
    weight: (c) => 0.5 + c * 0.5,
    gen: (rng) => ({
      'layout/minBoxes': rng.int(2, 3),
      'layout/maxBoxes': rng.int(4, 6),
      'layout/rowBias': rng.range(0.5, 0.9),
      'layout/minBoxW': 420,
      'layout/minBoxH': 160,
      'layout/gutter': rng.int(6, 16),
      'layout/padding': rng.int(10, 24),
      'layout/maxFontPx': 400,
      'layout/lifeMin': rng.range(10, 14),
      'layout/lifeMax': rng.range(22, 34),
    }),
  },
  {
    // The classic poster look — the stage-1 default feel.
    name: 'poster',
    weight: () => 1,
    gen: (rng) => ({
      'layout/minBoxes': rng.int(8, 12),
      'layout/maxBoxes': rng.int(14, 24),
      'layout/rowBias': rng.range(0.6, 0.85),
      'layout/minBoxW': 260,
      'layout/minBoxH': 56,
      'layout/gutter': rng.int(3, 8),
      'layout/padding': rng.int(5, 10),
      'layout/maxFontPx': rng.int(140, 240),
      'layout/lifeMin': rng.range(7, 10),
      'layout/lifeMax': rng.range(18, 28),
    }),
  },
  {
    // Newspaper columns — vertical cuts dominate.
    name: 'columns',
    weight: (c) => 0.7 + c * 0.3,
    gen: (rng) => ({
      'layout/minBoxes': rng.int(12, 18),
      'layout/maxBoxes': rng.int(20, 32),
      'layout/rowBias': rng.range(0, 0.2),
      'layout/minBoxW': rng.int(140, 200),
      'layout/minBoxH': 70,
      'layout/gutter': rng.int(2, 6),
      'layout/padding': rng.int(4, 8),
      'layout/maxFontPx': rng.int(60, 110),
      'layout/lifeMin': rng.range(6, 9),
      'layout/lifeMax': rng.range(15, 24),
    }),
  },
  {
    // Tight stacked rows, full-width lines.
    name: 'rows',
    weight: () => 1,
    gen: (rng) => ({
      'layout/minBoxes': rng.int(14, 20),
      'layout/maxBoxes': rng.int(22, 32),
      'layout/rowBias': rng.range(0.9, 1),
      'layout/minBoxW': 380,
      'layout/minBoxH': rng.int(30, 44),
      'layout/gutter': rng.int(1, 4),
      'layout/padding': rng.int(3, 7),
      'layout/maxFontPx': rng.int(90, 150),
      'layout/lifeMin': rng.range(5, 8),
      'layout/lifeMax': rng.range(13, 20),
    }),
  },
  {
    // Mid-density mosaic grid.
    name: 'mosaic',
    weight: (c) => 0.6 + c * 0.6,
    gen: (rng) => ({
      'layout/minBoxes': rng.int(28, 36),
      'layout/maxBoxes': rng.int(40, 55),
      'layout/rowBias': rng.range(0.25, 0.5),
      'layout/minBoxW': 120,
      'layout/minBoxH': 34,
      'layout/gutter': rng.int(1, 4),
      'layout/padding': rng.int(3, 6),
      'layout/maxFontPx': rng.int(30, 55),
      'layout/lifeMin': rng.range(4, 7),
      'layout/lifeMax': rng.range(10, 17),
    }),
  },
  {
    // The wall: screen FULL of text, uniform small type, fast churn.
    name: 'wall',
    weight: (c) => 0.35 + c * 1.1,
    gen: (rng) => ({
      'layout/minBoxes': rng.int(70, 90),
      'layout/maxBoxes': rng.int(95, 130),
      'layout/rowBias': rng.range(0.55, 0.8),
      'layout/minBoxW': 90,
      'layout/minBoxH': 22,
      'layout/gutter': 2,
      'layout/padding': 3,
      'layout/maxFontPx': rng.int(13, 20),
      'layout/lifeMin': rng.range(3, 5),
      'layout/lifeMax': rng.range(7, 13),
    }),
  },
];

export function pickScene(rng: RNG, chaos: number, excludeName?: string): SceneDef {
  const candidates = SCENES.filter((s) => s.name !== excludeName);
  const weights = candidates.map((s) => s.weight(chaos));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Write the scene's targets into the live params and rebuild the layout. */
export function applyScene(scene: SceneDef, rng: RNG, params: ParamStore): void {
  const targets = scene.gen(rng);
  for (const [path, value] of Object.entries(targets)) {
    params.set(path, value);
  }
  params.trigger('layout/reshuffle');
}

