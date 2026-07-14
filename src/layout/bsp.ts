// BSP tree for the fractal grid. Splits are weighted by aspect ratio;
// split ratios are kept on the nodes so they can be perturbed live (gridBreathe).

import { RNG } from '../core/rng';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BSPNode =
  | { kind: 'leaf'; id: number }
  | {
      kind: 'split';
      dir: 'h' | 'v'; // 'v' = vertical cut (splits width), 'h' = horizontal cut (splits height)
      baseRatio: number;
      phase: number; // per-node phase for breathing
      a: BSPNode;
      b: BSPNode;
    };

export interface BSPOptions {
  targetLeaves: number;
  minW: number;
  minH: number;
  ratioLow: number;
  ratioHigh: number;
}

let nextLeafId = 0;

export function buildTree(rng: RNG, region: Rect, opts: BSPOptions): BSPNode {
  return split(rng, region, opts.targetLeaves, opts);
}

function split(rng: RNG, region: Rect, budget: number, opts: BSPOptions): BSPNode {
  const canV = region.w >= opts.minW * 2.1; // vertical cut needs width for two children
  const canH = region.h >= opts.minH * 2.1;
  if (budget <= 1 || (!canV && !canH)) {
    return { kind: 'leaf', id: nextLeafId++ };
  }

  // Wide regions prefer vertical splits, tall prefer horizontal.
  let dir: 'h' | 'v';
  if (canV && canH) {
    const aspect = region.w / region.h;
    const pVertical = aspect / (aspect + 1 / aspect); // aspect 1 → 0.5, wide → →1
    dir = rng.chance(pVertical) ? 'v' : 'h';
  } else {
    dir = canV ? 'v' : 'h';
  }

  const ratio = rng.range(opts.ratioLow, opts.ratioHigh);
  const [ra, rb] = splitRect(region, dir, ratio);

  // Distribute remaining leaf budget proportional to area.
  const budgetA = Math.max(1, Math.min(budget - 1, Math.round(budget * ratio)));
  const budgetB = budget - budgetA;

  return {
    kind: 'split',
    dir,
    baseRatio: ratio,
    phase: rng.range(0, Math.PI * 2),
    a: split(rng, ra, budgetA, opts),
    b: split(rng, rb, budgetB, opts),
  };
}

function splitRect(r: Rect, dir: 'h' | 'v', ratio: number): [Rect, Rect] {
  if (dir === 'v') {
    const wa = r.w * ratio;
    return [
      { x: r.x, y: r.y, w: wa, h: r.h },
      { x: r.x + wa, y: r.y, w: r.w - wa, h: r.h },
    ];
  }
  const ha = r.h * ratio;
  return [
    { x: r.x, y: r.y, w: r.w, h: ha },
    { x: r.x, y: r.y + ha, w: r.w, h: r.h - ha },
  ];
}

/**
 * Walk the tree and produce leaf rects in reading order (left-right, top-bottom
 * follows tree structure). `breathe` perturbs each split's ratio with a
 * per-node sine — this is the grid distortion/breathing primitive.
 */
export function computeLeafRects(
  node: BSPNode,
  region: Rect,
  breathe: { amount: number; time: number } | null,
  out: { id: number; rect: Rect }[] = [],
): { id: number; rect: Rect }[] {
  if (node.kind === 'leaf') {
    out.push({ id: node.id, rect: region });
    return out;
  }
  let ratio = node.baseRatio;
  if (breathe && breathe.amount > 0) {
    const wobble = Math.sin(breathe.time * 1.7 + node.phase) * 0.15 * breathe.amount;
    ratio = Math.min(0.85, Math.max(0.15, node.baseRatio + wobble));
  }
  const [ra, rb] = splitRect(region, node.dir, ratio);
  computeLeafRects(node.a, ra, breathe, out);
  computeLeafRects(node.b, rb, breathe, out);
  return out;
}

export function countLeaves(node: BSPNode): number {
  return node.kind === 'leaf' ? 1 : countLeaves(node.a) + countLeaves(node.b);
}
