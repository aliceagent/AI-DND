/** SRD 5.2 (2024) character model — creation data, build validation, and
 *  derivation. The engine, never the UI or a model, is the authority on
 *  legality: illegal builds throw. Derived numbers are COMPUTED from the
 *  build, never stored (CLAUDE.md data model); the character_created event
 *  embeds the derived snapshot so the fold stays a pure data application
 *  and replay never recomputes rules.
 *
 *  Scope (level 1–2, the four SRD archetype classes): enough for the
 *  vertical slice. Feats, multiclassing, and full equipment lists are
 *  deliberately deferred (docs/charcreate-box-plan.md). */

import { type Ability, type Abilities, type AttackSpec, type StatBlock, SKILL_ABILITY, mod } from "./srd.js";

// ------------------------------------------------------------------ data

export interface SpeciesDef { id: string; name: string; speed: number; traits: string[] }

export const SPECIES: Record<string, SpeciesDef> = {
  human:    { id: "human", name: "Human", speed: 30, traits: ["resourceful", "skillful"] },
  elf:      { id: "elf", name: "Elf", speed: 30, traits: ["darkvision", "keen senses", "trance"] },
  dwarf:    { id: "dwarf", name: "Dwarf", speed: 30, traits: ["darkvision", "dwarven resilience", "stonecunning"] },
  halfling: { id: "halfling", name: "Halfling", speed: 30, traits: ["brave", "halfling nimbleness", "luck"] },
  orc:      { id: "orc", name: "Orc", speed: 30, traits: ["darkvision", "adrenaline rush", "relentless endurance"] },
};

export interface BackgroundDef {
  id: string; name: string;
  abilities: [Ability, Ability, Ability]; // 2024: the background carries the ASI
  skills: [string, string];
}

export const BACKGROUNDS: Record<string, BackgroundDef> = {
  soldier:  { id: "soldier", name: "Soldier", abilities: ["str", "dex", "con"], skills: ["athletics", "intimidation"] },
  criminal: { id: "criminal", name: "Criminal", abilities: ["dex", "con", "int"], skills: ["sleight_of_hand", "stealth"] },
  acolyte:  { id: "acolyte", name: "Acolyte", abilities: ["int", "wis", "cha"], skills: ["insight", "religion"] },
  sage:     { id: "sage", name: "Sage", abilities: ["con", "int", "wis"], skills: ["arcana", "history"] },
  guide:    { id: "guide", name: "Guide", abilities: ["dex", "con", "wis"], skills: ["stealth", "survival"] },
};

export interface ClassDef {
  id: string; name: string;
  hitDie: number;
  saves: [Ability, Ability];
  skillChoices: { count: number; from: string[] };
  /** AC formula: base + dex (capped); shieldless defaults for the slice. */
  armor: { name: string; base: number; dexCap: number };
  attack: (a: Abilities, prof: number) => AttackSpec;
  slotsByLevel: Record<number, Record<number, number>>; // level -> {slotLevel: count}
}

export const CLASSES: Record<string, ClassDef> = {
  fighter: {
    id: "fighter", name: "Fighter", hitDie: 10, saves: ["str", "con"],
    skillChoices: { count: 2, from: ["acrobatics", "animal_handling", "athletics", "history", "insight", "intimidation", "perception", "survival"] },
    armor: { name: "chain mail", base: 16, dexCap: 0 },
    attack: (a, p) => ({ name: "Longsword", toHit: p + mod(a.str), damage: `1d8+${mod(a.str)}`, type: "slashing", kind: "melee" }),
    slotsByLevel: {},
  },
  rogue: {
    id: "rogue", name: "Rogue", hitDie: 8, saves: ["dex", "int"],
    skillChoices: { count: 4, from: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "persuasion", "sleight_of_hand", "stealth"] },
    armor: { name: "leather", base: 11, dexCap: 99 },
    attack: (a, p) => ({ name: "Shortsword", toHit: p + mod(a.dex), damage: `1d6+${mod(a.dex)}`, type: "piercing", kind: "melee" }),
    slotsByLevel: {},
  },
  cleric: {
    id: "cleric", name: "Cleric", hitDie: 8, saves: ["wis", "cha"],
    skillChoices: { count: 2, from: ["history", "insight", "medicine", "persuasion", "religion"] },
    armor: { name: "chain shirt", base: 13, dexCap: 2 },
    attack: (a, p) => ({ name: "Mace", toHit: p + mod(a.str), damage: `1d6+${mod(a.str)}`, type: "bludgeoning", kind: "melee" }),
    slotsByLevel: { 1: { 1: 2 }, 2: { 1: 3 } },
  },
  wizard: {
    id: "wizard", name: "Wizard", hitDie: 6, saves: ["int", "wis"],
    skillChoices: { count: 2, from: ["arcana", "history", "insight", "investigation", "medicine", "nature", "religion"] },
    armor: { name: "unarmored", base: 10, dexCap: 99 },
    attack: (a, p) => ({ name: "Fire Bolt", toHit: p + mod(a.int), damage: "1d10", type: "fire", kind: "ranged" }),
    slotsByLevel: { 1: { 1: 2 }, 2: { 1: 3 } },
  },
};

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

// ----------------------------------------------------------------- build

export interface CharacterBuild {
  id: string;                  // e.g. "pc.kael"
  name: string;
  species: string;
  class: string;
  background: string;
  /** Pre-background scores, standard array or point buy. */
  abilities: Abilities;
  /** Background ASI (2024): +2/+1 on two of the background's abilities,
   *  or +1/+1/+1 across all three. */
  abilityBonus: Partial<Record<Ability, number>>;
  skills: string[];            // class skill choices (background's are automatic)
  level?: number;              // default 1
}

const ABILITY_KEYS: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

export function validateBuild(b: CharacterBuild): void {
  const fail = (msg: string) => { throw new Error(`illegal build: ${msg}`); };

  if (!b.id?.trim() || !b.name?.trim()) fail("missing id or name");
  const species = SPECIES[b.species] ?? fail(`unknown species "${b.species}"`);
  const klass = CLASSES[b.class] ?? fail(`unknown class "${b.class}"`);
  const bg = BACKGROUNDS[b.background] ?? fail(`unknown background "${b.background}"`);
  const level = b.level ?? 1;
  if (level < 1 || level > 2) fail(`level ${level} out of supported range (1-2)`);

  // base scores: standard array (any assignment) or legal point buy
  const scores = ABILITY_KEYS.map(k => b.abilities[k]);
  if (scores.some(s => typeof s !== "number")) fail("all six abilities required");
  const isArray = [...scores].sort((x, y) => x - y).join() === [...STANDARD_ARRAY].sort((x, y) => x - y).join();
  if (!isArray) {
    if (scores.some(s => s < 8 || s > 15)) fail("point-buy scores must be 8-15 before bonuses");
    const cost = scores.reduce((a, s) => a + POINT_COST[s], 0);
    if (cost > POINT_BUY_BUDGET) fail(`point-buy cost ${cost} exceeds ${POINT_BUY_BUDGET}`);
  }

  // background ASI: +2/+1 or +1/+1/+1, only on the background's abilities
  const bonus = Object.entries(b.abilityBonus ?? {}) as [Ability, number][];
  const values = bonus.map(([, v]) => v).sort((x, y) => y - x).join(",");
  if (values !== "2,1" && values !== "1,1,1") fail("ability bonus must be +2/+1 or +1/+1/+1");
  for (const [k] of bonus)
    if (!bg.abilities.includes(k)) fail(`bonus to ${k} not allowed by background ${bg.id} (${bg.abilities.join("/")})`);

  // skills: exact count, from the class list, no overlap with background
  if (b.skills.length !== klass.skillChoices.count)
    fail(`${klass.id} chooses exactly ${klass.skillChoices.count} skills`);
  for (const s of b.skills) {
    if (!SKILL_ABILITY[s]) fail(`unknown skill "${s}"`);
    if (!klass.skillChoices.from.includes(s)) fail(`"${s}" not a ${klass.id} skill option`);
    if (bg.skills.includes(s)) fail(`already proficient in "${s}" from background ${bg.id}`);
  }
  if (new Set(b.skills).size !== b.skills.length) fail("duplicate skill choice");
  void species;
}

// ---------------------------------------------------------------- derive

export interface DerivedSheet extends StatBlock {
  level: number;
  species: string;
  class: string;
  background: string;
  speed: number;
  finalAbilities: Abilities;
  armorName: string;
  passivePerception: number;
  traits: string[];
}

/** Compute everything from the build. Pure; never stored mutable. */
export function derive(b: CharacterBuild): DerivedSheet {
  validateBuild(b);
  const klass = CLASSES[b.class];
  const species = SPECIES[b.species];
  const bg = BACKGROUNDS[b.background];
  const level = b.level ?? 1;
  const prof = 2; // levels 1-4

  const finalAbilities = { ...b.abilities };
  for (const [k, v] of Object.entries(b.abilityBonus ?? {}) as [Ability, number][]) {
    finalAbilities[k] += v;
    if (finalAbilities[k] > 17) throw new Error(`illegal build: ${k} above 17 at creation`);
  }

  const con = mod(finalAbilities.con);
  // level 1: max die + con; level 2: + average (die/2+1) + con
  const maxHp = klass.hitDie + con + (level >= 2 ? Math.floor(klass.hitDie / 2) + 1 + con : 0);
  const dex = mod(finalAbilities.dex);
  const ac = klass.armor.base + Math.min(dex, klass.armor.dexCap);
  const skills = [...bg.skills, ...b.skills].sort();
  const perception = 10 + mod(finalAbilities.wis) + (skills.includes("perception") ? prof : 0);

  return {
    ref: b.id, name: b.name, side: "pc",
    ac, maxHp: Math.max(1, maxHp),
    abilities: finalAbilities,
    attacks: [klass.attack(finalAbilities, prof)],
    proficiency: prof,
    saves: [...klass.saves],
    skills,
    slots: klass.slotsByLevel[level] ?? undefined,
    hitDice: { die: klass.hitDie, count: level },
    level,
    species: species.id, class: klass.id, background: bg.id,
    speed: species.speed,
    finalAbilities,
    armorName: klass.armor.name,
    passivePerception: perception,
    traits: species.traits,
  };
}

/** Level-up derivation: the delta the level_up event embeds. */
export function deriveLevelUp(b: CharacterBuild, toLevel: number,
                              hp: { method: "average" } | { method: "roll"; reported: number }):
    { level: number; maxHpDelta: number; slots?: Record<number, number>; hitDiceCount: number } {
  const klass = CLASSES[b.class] ?? (() => { throw new Error(`unknown class "${b.class}"`); })();
  const from = b.level ?? 1;
  if (toLevel !== from + 1) throw new Error(`illegal level-up: ${from} → ${toLevel}`);
  if (toLevel > 2) throw new Error("levels above 2 are deferred");
  const con = mod(derive({ ...b }).finalAbilities.con);
  let gained: number;
  if (hp.method === "average") gained = Math.floor(klass.hitDie / 2) + 1 + con;
  else {
    if (!(hp.reported >= 1 && hp.reported <= klass.hitDie))
      throw new Error(`reported hit-die roll ${hp.reported} outside 1-${klass.hitDie}`);
    gained = hp.reported + con;
  }
  return { level: toLevel, maxHpDelta: Math.max(1, gained),
    slots: klass.slotsByLevel[toLevel], hitDiceCount: toLevel };
}
