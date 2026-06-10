/** Campaign style presets — the visual half of the tone profile. Pure data:
 *  the same preset feeds prep anchors, state variants, and live improv so a
 *  campaign reads as one hand painted it. Prompt language here is original
 *  and generic; entity specifics come only from card prompt_fragments. */

export interface StylePreset {
  id: string;
  prefix: string;            // leads every prompt
  suffix: string;            // trails every prompt
  negative: string;          // model-level negative prompt (quality, not content)
  params: { width: number; height: number; steps: number; cfg: number };
  improvParams: { steps: number; cfg: number }; // SDXL-Turbo-class settings
}

export const PRESETS: Record<string, StylePreset> = {
  "hermys.ink-and-ember": {
    id: "hermys.ink-and-ember",
    prefix: "dark fantasy illustration, painterly ink lines with ember-lit accents, muted palette, volumetric haze,",
    suffix: ", dramatic chiaroscuro, weathered textures, cinematic depth, no text",
    negative: "photograph, modern objects, watermark, signature, blurry, deformed hands, text, logo",
    params: { width: 1216, height: 832, steps: 32, cfg: 6.0 },
    improvParams: { steps: 4, cfg: 1.5 },
  },
};

export const DEFAULT_PRESET = "hermys.ink-and-ember";

export function preset(id: string | undefined): StylePreset {
  const p = PRESETS[id ?? DEFAULT_PRESET];
  if (!p) throw new Error(`unknown style preset: ${id}`);
  return p;
}
