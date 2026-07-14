// Fonts registry. Stage 1 has one entry, but every box already carries a
// fontId resolved through here — per-box font mixing later means adding
// entries, nothing else.

export interface FontDef {
  id: string;
  /** SINGLE family name for p5.textFont — p5 quote-wraps the whole string, so
   *  a comma-separated stack silently becomes one bogus family (→ Times). */
  family: string;
}

export const FONTS: Record<string, FontDef> = {
  main: {
    id: 'main',
    family: 'Space Grotesk',
  },
};

export function resolveFont(id: string): FontDef {
  return FONTS[id] ?? FONTS.main;
}
