/** Backstory → portrait (charcreate-box-plan §C): distill the player's
 *  spoken story into a visual-bible-format block (the same 40–80-word
 *  canonical shape campaign art uses), wrap it in the campaign style as a
 *  16:9 portrait prompt, and hand it to MediaService. The block seam is
 *  the usual split: deterministic tables on the Mac, the Director-route
 *  LLM on the Spark. The PROMPT is always produced and persisted on the
 *  portrait_attached event — render now or later, the face is repeatable. */

import { preset } from "../../../vision/src/style.js";
import type { CharacterBuild } from "../../../engine/src/character.js";

export interface BlockDistiller {
  readonly kind: "deterministic" | "llm";
  distill(build: CharacterBuild, backstory: string): Promise<string>;
}

const SPECIES_LOOK: Record<string, string> = {
  human: "a weathered human",
  elf: "a slender elf with fine features and faintly pointed ears",
  dwarf: "a broad-built dwarf with a braided beard",
  halfling: "a small, quick-eyed halfling",
  orc: "a tall, heavy-framed orc with proud tusks",
};

const CLASS_GARB: Record<string, string> = {
  fighter: "in battered steel splint over a chain skirt, a longsword across the shoulder",
  rogue: "in supple dark leathers, hood thrown loose, a shortsword easy at the hip",
  cleric: "in a chain shirt beneath plain temple vestments, mace and brass holy sigil at the belt",
  wizard: "in travel-stained robes lined with scroll pockets, a copper-bound staff in hand",
};

const BACKGROUND_BEARING: Record<string, string> = {
  soldier: "carrying themselves with drilled, square-shouldered discipline",
  criminal: "standing easy and watchful, weight on the back foot, eyes on the exits",
  acolyte: "bearing a calm, attentive stillness",
  sage: "peering out with bright, cataloguing curiosity",
  guide: "reading the edges of the frame from long habit",
};

const CLASS_PALETTE: Record<string, string> = {
  fighter: "steel grey, oxblood leather, dull brass",
  rogue: "charcoal and night-blue, worn black leather",
  cleric: "bone white, temple brass, candle gold",
  wizard: "deep violet, ink black, parchment",
};

/** Visible marks a story can leave — only what a camera could see. */
const VISIBLE_MARKS: [RegExp, string][] = [
  [/scar|scarred/i, "an old scar they no longer hide"],
  [/burn|fire|flame/i, "faint burn-marks along one forearm"],
  [/sea|sailor|ship|coast/i, "skin weathered by salt and sun"],
  [/soldier|war|battle|bridge|siege/i, "campaign-worn gear mended many times"],
  [/temple|shrine|monastery|faith/i, "a small devotional token worn smooth"],
  [/thief|purse|ledger|smuggl|caravan/i, "quick hands and a coin kept moving across the knuckles"],
  [/forest|wild|hunt/i, "trail dust and a hunter's patience"],
  [/old|grey|gray|years/i, "grey coming in at the temples"],
];

export class DeterministicDistiller implements BlockDistiller {
  readonly kind = "deterministic" as const;
  async distill(build: CharacterBuild, backstory: string): Promise<string> {
    const look = SPECIES_LOOK[build.species] ?? `a striking ${build.species}`;
    const garb = CLASS_GARB[build.class] ?? "in practical traveling gear";
    const bearing = BACKGROUND_BEARING[build.background] ?? "with steady, unreadable poise";
    const mark = VISIBLE_MARKS.find(([re]) => re.test(backstory))?.[1];
    return `${build.name} — ${look} ${garb}, ${bearing}.` +
      (mark ? ` ${cap(mark)}.` : "") +
      ` Their gaze holds the story they just told.`;
  }
}

/** Spark route: the Director-model writes the block from the transcript.
 *  Constructed only when an endpoint is configured. */
export class LlmDistiller implements BlockDistiller {
  readonly kind = "llm" as const;
  async distill(build: CharacterBuild, backstory: string): Promise<string> {
    const { HttpLlm } = await import("../../../brain/src/llm.js");
    const res = await new HttpLlm().chat({
      messages: [
        { role: "system", content: "Write a 40-80 word visual description block for a fantasy character portrait: face, build, costume, bearing, one distinguishing mark drawn from their story. ORIGINAL language, concrete and paintable, no game mechanics. Reply with the block only." },
        { role: "user", content: `${build.name}, ${build.species} ${build.class} (${build.background}).\nTheir story, in their own words: ${backstory}` },
      ],
      temperature: 0.6,
    });
    const text = (res.content ?? "").trim();
    if (!text) throw new Error("empty distill");
    return text;
  }
}

export function createDistiller(kind = process.env.HERMYS_CHARVIS ?? "deterministic"): BlockDistiller {
  return kind === "llm" ? new LlmDistiller() : new DeterministicDistiller();
}

/** Wrap the block exactly like the campaign's portrait prompts, so player
 *  faces and campaign art come from one visual hand. */
export function buildPortraitPrompt(block: string, build: CharacterBuild): { prompt: string; negative: string; seed: number } {
  const style = preset(undefined);
  const palette = CLASS_PALETTE[build.class] ?? "muted campaign palette";
  return {
    prompt: [
      style.prefix,
      block,
      `Composition: three-quarter character portrait anchored on the right third, facing into the open left two-thirds of the widescreen frame; plain atmospheric backdrop of drifting smoke and ember-lit haze, deep negative space on the left; subject lit by a single motivated warm source with cool rim light.`,
      `Lighting and palette: ${palette}.`,
      `Widescreen 16:9 cinematic still, full-bleed, no letterboxing.`,
    ].join(" ").replace(/\s+/g, " ").trim() + style.suffix,
    negative: style.negative,
    seed: fnv1a(`${build.id}/portrait`),
  };
}

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
