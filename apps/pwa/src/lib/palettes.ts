/** Palette → procedural backdrop. Every visual slot must render without
 *  art (roadmap principle 2): these gradients + a location sigil ARE the
 *  establishing visual until the Spark's renders land, and they stay as
 *  the ambient layer behind play afterwards. Keys match scene_set.palette
 *  / the campaign style vocabulary. */

export interface Backdrop {
  gradient: string;     // CSS background-image
  glow: string;         // accent for titles/sigils
  particle: string;     // particle tint (polish pass)
}

const P: Record<string, Backdrop> = {
  "night-blues": {
    gradient: "radial-gradient(120% 90% at 50% 10%, #1b2433 0%, #10141f 45%, #07090f 100%)",
    glow: "#8fb7d4", particle: "#3d5a78",
  },
  "lamp-gold": {
    gradient: "radial-gradient(110% 80% at 50% 85%, #3a2d18 0%, #1f1810 50%, #0c0a06 100%)",
    glow: "#e0b35c", particle: "#8a6b2f",
  },
  "ember-red": {
    gradient: "radial-gradient(130% 100% at 50% 100%, #3d1d12 0%, #1f0f0a 55%, #0a0605 100%)",
    glow: "#e07a4f", particle: "#a04528",
  },
  "cave-dark": {
    gradient: "radial-gradient(100% 80% at 50% 0%, #16201c 0%, #0c1210 50%, #050706 100%)",
    glow: "#7fae9a", particle: "#2e4a40",
  },
  "grass-day": {
    gradient: "linear-gradient(180deg, #2c3d52 0%, #3a4a35 60%, #2a3526 100%)",
    glow: "#cdd9a3", particle: "#6a7a4f",
  },
};

const FALLBACK: Backdrop = {
  gradient: "radial-gradient(120% 90% at 50% 20%, #221e2e 0%, #14111d 55%, #0a0810 100%)",
  glow: "#cdbf9a", particle: "#4a3f6b",
};

export function backdrop(palette: string | null | undefined): Backdrop {
  return P[palette ?? ""] ?? FALLBACK;
}

/** A location's sigil: deterministic glyph from its id — the same place
 *  always wears the same mark, art or no art. */
const GLYPHS = ["◈", "▲", "❖", "⌂", "♦", "✦", "☗", "⛰", "🜃", "🜂"];
export function sigil(locationId: string): string {
  let h = 0;
  for (const ch of locationId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GLYPHS[h % GLYPHS.length];
}
