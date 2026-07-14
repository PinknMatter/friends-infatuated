// THE signature effect. Indexes all visible words (lowercased, stopwords
// removed); when a word appears in ≥2 boxes, periodically flashes the matching
// words simultaneously across boxes. Marks soloActive while firing so the
// scheduler calms everything else down.

import type { GlobalEffect, EffectCtx } from '../types';
import type { TextBox } from '../../layout/layoutEngine';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'i', 'me', 'my', 'we',
  'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its',
  'they', 'them', 'their', 'that', 'this', 'so', 'just', 'like', 'from',
  'la', 'el', 'de', 'en', 'y', 'le', 'les', 'et', 'der', 'die', 'das', 'und',
]);

interface Match {
  word: string;
  sites: { boxId: number; wordIndex: number }[];
}

const FLASH_COLOR = '#ffffff';
const FLASH_TEXT = '#000000';

export const similarWords: GlobalEffect = {
  id: 'similarWords',
  kind: 'global',
  wantsSolo: true,
  soloActive: false,

  update(boxes: TextBox[], intensity: number, ctx: EffectCtx) {
    this.soloActive = false;
    if (intensity <= 0.05) return;

    const interval = ctx.params.num('fx/similarWords/interval');
    const flashDur = ctx.params.num('fx/similarWords/flashDur');
    const cycle = interval + flashDur;
    const cyclePos = ctx.time % cycle;
    const cycleIndex = Math.floor(ctx.time / cycle);

    if (cyclePos > flashDur) return; // waiting for next fire

    // Rebuild the index for this fire (boxes change under us; cheap at ~20 boxes).
    const index = new Map<string, Match>();
    for (const box of boxes) {
      box.words.forEach((raw, wordIndex) => {
        const word = raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        if (word.length < 3 || STOPWORDS.has(word)) return;
        const m = index.get(word) ?? { word, sites: [] };
        m.sites.push({ boxId: box.id, wordIndex });
        index.set(word, m);
      });
    }
    const matches = [...index.values()].filter(
      (m) => new Set(m.sites.map((s) => s.boxId)).size >= 2,
    );
    if (matches.length === 0) return;

    // Deterministic pick per cycle so the same word stays lit for the whole flash.
    const match = matches[cycleIndex % matches.length];
    this.soloActive = true;

    // Pulse envelope: sharp in, ease out.
    const t = cyclePos / flashDur;
    const env = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    const strength = env * intensity;

    for (const box of boxes) {
      const mine = match.sites.filter((s) => s.boxId === box.id);
      if (mine.length === 0) {
        // Calm non-matching boxes so the flash reads clearly.
        box.style.dim = Math.max(box.style.dim, 0.45 * strength);
        continue;
      }
      for (const site of mine) {
        const prev = box.style.perWord.get(site.wordIndex) ?? {};
        box.style.perWord.set(site.wordIndex, {
          ...prev,
          boxFill: FLASH_COLOR,
          fill: FLASH_TEXT,
        });
      }
    }
  },
};
