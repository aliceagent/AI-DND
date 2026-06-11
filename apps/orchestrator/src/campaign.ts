/** Campaign presentation packs: the loader and the host-driven DM.
 *
 *  A pack is one JSON file (HERMYS_CAMPAIGN=path) carrying locations,
 *  edges, beats, and stat blocks. The shape is public; the CONTENT for
 *  real campaigns lives in the private pack repo and never ships here.
 *  Beats carry a gm-only panel (summary, hints, constraints, secrets) —
 *  the hub sends it to the host seat alone; boxes and the screen receive
 *  only the events a beat produces (scene_set, joins, initiative).
 *
 *  CampaignDM is the human-host mode: the table talks, the host narrates
 *  aloud; the engine still calls checks on action verbs so the roll pads
 *  keep working. The AI Director replaces it on the Spark — same data. */

import { readFileSync } from "node:fs";
import { Engine } from "../../../engine/src/engine.js";
import { KOBOLD, SKILL_ABILITY, type StatBlock, type Ability } from "../../../engine/src/srd.js";
import type { DungeonMaster } from "./dm.js";

export interface CampaignLocation {
  id: string; name: string; mood: string; palette: string; x: number; y: number;
}

export interface CampaignBeat {
  id: string; title: string; location: string;
  encounter: { groups: { stat_ref: string; count: number }[] } | null;
  gm?: { summary?: string; hints?: string[]; constraints?: string[];
         secrets?: string[]; dialogue_refs?: string[] };
}

export interface Campaign {
  id: string; title: string;
  locations: Record<string, CampaignLocation>;
  edges: [string, string][];
  beats: CampaignBeat[];
  statblocks: Record<string, StatBlock>;
}

const BUILTIN_STATS: Record<string, StatBlock> = { "srd.kobold": KOBOLD };

export function validateCampaign(raw: unknown): Campaign {
  const fail = (msg: string) => { throw new Error(`bad campaign pack: ${msg}`); };
  const c = raw as Campaign;
  if (!c?.id || !c?.title) fail("missing id/title");
  if (!c.locations || !Object.keys(c.locations).length) fail("no locations");
  for (const [id, l] of Object.entries(c.locations)) {
    if (l.id !== id) fail(`location key ${id} != id ${l.id}`);
    for (const k of ["name", "mood", "palette"]) if (!(l as any)[k]) fail(`${id} missing ${k}`);
    if (typeof l.x !== "number" || typeof l.y !== "number") fail(`${id} needs map x/y`);
  }
  for (const [a, b] of c.edges ?? [])
    if (!c.locations[a] || !c.locations[b]) fail(`edge ${a}–${b} references missing location`);
  if (!Array.isArray(c.beats) || !c.beats.length) fail("no beats");
  for (const b of c.beats) {
    if (!b.id || !b.title) fail("beat missing id/title");
    if (!c.locations[b.location]) fail(`beat ${b.id}: unknown location ${b.location}`);
    for (const g of b.encounter?.groups ?? []) {
      if (!(g.count >= 1)) fail(`beat ${b.id}: bad count for ${g.stat_ref}`);
      if (!c.statblocks?.[g.stat_ref] && !BUILTIN_STATS[g.stat_ref])
        fail(`beat ${b.id}: unresolved stat_ref ${g.stat_ref}`);
    }
  }
  return c;
}

export function loadCampaign(path: string): Campaign {
  return validateCampaign(JSON.parse(readFileSync(path, "utf8")));
}

export function statFor(c: Campaign, ref: string): StatBlock {
  return c.statblocks?.[ref] ?? BUILTIN_STATS[ref];
}

/** Run one beat: scene + encounter, as events. Narration is the HOST's
 *  voice at the table (the Director's on the Spark) — never auto-spoken. */
export function runBeat(engine: Engine, c: Campaign, beatId: string): CampaignBeat {
  const beat = c.beats.find(b => b.id === beatId);
  if (!beat) throw new Error(`unknown beat: ${beatId}`);
  const loc = c.locations[beat.location];
  engine.setScene({ id: loc.id, name: loc.name, mood: loc.mood, palette: loc.palette });
  if (beat.encounter) {
    let spawned = false;
    for (const g of beat.encounter.groups) {
      const sb = statFor(c, g.stat_ref);
      for (let i = 1; i <= g.count; i++) {
        const id = `${g.stat_ref}.${beat.id}.${i}`;
        if (!engine.state().combatants[id]) {
          engine.join(id, { ...sb, name: `${sb.name} ${i}` });
          spawned = true;
        }
      }
    }
    if (spawned) engine.rollInitiativeAll();
  }
  return beat;
}

/** Host-driven table: checks still flow, narration stays human. */
export class CampaignDM implements DungeonMaster {
  constructor(readonly campaign: Campaign) {}

  async openScene(): Promise<string> {
    return `The table gathers for ${this.campaign.title}. The host will set the first scene.`;
  }

  async takeTurn(engine: Engine, decl: { actor: string; text: string }): Promise<string> {
    const skill = matchSkill(decl.text);
    if (skill) {
      engine.callCheck({ actor: decl.actor, kind: "check",
        ability: SKILL_ABILITY[skill] as Ability, skill, dc: 12 });
      const name = engine.state().combatants[decl.actor]?.name ?? decl.actor;
      return `${name}, give me a ${skill.replace(/_/g, " ")} check.`;
    }
    return ""; // silence: the host answers with their own voice
  }

  async afterRoll(engine: Engine, checkId: number): Promise<string> {
    const resolved = engine.store.timeline().find(e =>
      e.type === "check_resolved" && e.visibility === "public" &&
      (e.payload as any).checkId === checkId);
    return (resolved?.payload as any)?.outcome === "success"
      ? "The roll lands." : "The roll falls short.";
  }
}

const SKILL_HINTS: [RegExp, string][] = [
  [/search|investigat|examine|inspect/i, "investigation"],
  [/look|spot|watch|scan|listen/i, "perception"],
  [/sneak|hide|quiet/i, "stealth"],
  [/climb|lift|shove|force|push/i, "athletics"],
  [/persuad|convince|appeal/i, "persuasion"],
  [/intimidat|threaten/i, "intimidation"],
];

function matchSkill(text: string): string | null {
  for (const [re, skill] of SKILL_HINTS) if (re.test(text)) return skill;
  return null;
}
