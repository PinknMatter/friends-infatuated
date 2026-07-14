// Binary-search the largest font size whose wrapped text fits a rect,
// and produce a cached word-positioned layout the renderer consumes.
// Text measurement is the hot path — everything here is cached per
// (text, bucketed size, font).

import type p5 from 'p5';

export interface WordLayout {
  text: string;
  wordIndex: number;
  x: number; // relative to line start, left-justified
  w: number;
  charStart: number; // global char index (spaces counted) — used by typewriter/scramble
}

export interface LineLayout {
  words: WordLayout[];
  y: number; // baseline y relative to text block top
  width: number;
}

export interface TextLayout {
  fontSize: number;
  lineHeight: number;
  ascent: number;
  lines: LineLayout[];
  totalHeight: number;
  charCount: number;
  maxWidth: number;
}

const LINE_HEIGHT_FACTOR = 1.06; // tight — rows should read squeezed together
const MIN_SIZE = 9;
const MAX_SIZE = 260;

const cache = new Map<string, TextLayout>();

export function clearFitCache(): void {
  cache.clear();
}

/**
 * Largest font size such that `text` wraps inside w×h. Returns the full
 * word-positioned layout. `g` must already have the target font set.
 */
export function fitText(
  g: p5.Graphics,
  text: string,
  w: number,
  h: number,
  fontId: string,
): TextLayout {
  // Bucket rect size to 4px so tween frames hit the cache.
  const bw = Math.max(8, Math.round(w / 4) * 4);
  const bh = Math.max(8, Math.round(h / 4) * 4);
  const key = `${fontId}|${bw}x${bh}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let lo = MIN_SIZE;
  let hi = MAX_SIZE;
  let best: TextLayout | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const layout = layoutAtSize(g, text, mid, bw);
    if (layout.totalHeight <= bh && layout.maxWidth <= bw) {
      best = layout;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const result = best ?? layoutAtSize(g, text, MIN_SIZE, bw);
  cache.set(key, result);
  if (cache.size > 4000) cache.clear(); // crude bound; rebuilds are cheap enough
  return result;
}

function layoutAtSize(g: p5.Graphics, text: string, size: number, maxW: number): TextLayout {
  g.textSize(size);
  const spaceW = g.textWidth(' ');
  const words = text.split(/\s+/).filter(Boolean);
  const lineHeight = size * LINE_HEIGHT_FACTOR;
  const ascent = g.textAscent();

  const lines: LineLayout[] = [];
  let cur: WordLayout[] = [];
  let curX = 0;
  let charCursor = 0;
  let maxWidth = 0;

  const pushLine = () => {
    if (cur.length === 0) return;
    const width = curX - spaceW; // trailing space removed
    lines.push({ words: cur, y: ascent + lines.length * lineHeight, width });
    maxWidth = Math.max(maxWidth, width);
    cur = [];
    curX = 0;
  };

  words.forEach((word, wordIndex) => {
    const ww = g.textWidth(word);
    if (curX > 0 && curX + ww > maxW) pushLine();
    cur.push({ text: word, wordIndex, x: curX, w: ww, charStart: charCursor });
    curX += ww + spaceW;
    charCursor += word.length + 1; // +1 for the space
  });
  pushLine();

  return {
    fontSize: size,
    lineHeight,
    ascent,
    lines,
    totalHeight: lines.length > 0 ? (lines.length - 1) * lineHeight + size * 1.05 : 0,
    charCount: Math.max(0, charCursor - 1),
    maxWidth,
  };
}
