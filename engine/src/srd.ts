/** SRD 5.2 (CC-BY-4.0) minimal data layer for the Phase 1 exit test.
 *  Production grows this into the full rules core; the shapes are final. */

export interface Abilities { str: number; dex: number; con: number; int: number; wis: number; cha: number }

export type Ability = keyof Abilities;

export const mod = (score: number) => Math.floor((score - 10) / 2);

/** SRD 5.2 skill list with governing abilities. */
export const SKILL_ABILITY: Record<string, Ability> = {
  athletics: "str",
  acrobatics: "dex", sleight_of_hand: "dex", stealth: "dex",
  arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
  animal_handling: "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
  deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
};

export interface AttackSpec { name: string; toHit: number; damage: string; type: string; kind?: "melee" | "ranged" }

export interface StatBlock {
  ref: string;                // engine stat id, e.g. "srd.kobold"
  name: string;
  side: "pc" | "npc";
  ac: number;
  maxHp: number;
  abilities: Abilities;
  attacks: AttackSpec[];
  proficiency: number;
  saves?: Ability[];          // proficient saving throws
  skills?: string[];          // proficient skills (keys of SKILL_ABILITY)
  slots?: Record<number, number>;          // spell slot level -> count
  hitDice?: { die: number; count: number } // e.g. { die: 10, count: 1 }
}

/** Ability-check modifier (skill proficiency applies if listed). */
export function checkModifier(sb: StatBlock, ability: Ability, skill?: string | null): number {
  const prof = skill && sb.skills?.includes(skill) ? sb.proficiency : 0;
  return mod(sb.abilities[ability]) + prof;
}

/** Saving-throw modifier. */
export function saveModifier(sb: StatBlock, ability: Ability): number {
  return mod(sb.abilities[ability]) + (sb.saves?.includes(ability) ? sb.proficiency : 0);
}

/** SRD kobold (2025 SRD 5.2). */
export const KOBOLD: StatBlock = {
  ref: "srd.kobold", name: "Kobold", side: "npc",
  ac: 12, maxHp: 5,
  abilities: { str: 7, dex: 15, con: 9, int: 8, wis: 7, cha: 8 },
  attacks: [{ name: "Dagger", toHit: 4, damage: "1d4+2", type: "piercing" }],
  proficiency: 2,
};

/** Simplified level-1 PC archetypes for the scripted skirmish. */
export const PCS: StatBlock[] = [
  { ref: "pc.fighter", name: "Kael", side: "pc", ac: 16, maxHp: 12,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 11, cha: 10 },
    attacks: [{ name: "Longsword", toHit: 5, damage: "1d8+3", type: "slashing" }], proficiency: 2,
    saves: ["str", "con"], skills: ["athletics", "perception"], hitDice: { die: 10, count: 1 } },
  { ref: "pc.rogue", name: "Vex", side: "pc", ac: 14, maxHp: 9,
    abilities: { str: 10, dex: 16, con: 12, int: 13, wis: 12, cha: 14 },
    attacks: [{ name: "Shortsword", toHit: 5, damage: "1d6+3", type: "piercing" }], proficiency: 2,
    saves: ["dex", "int"], skills: ["stealth", "acrobatics", "perception"], hitDice: { die: 8, count: 1 } },
  { ref: "pc.cleric", name: "Mara", side: "pc", ac: 16, maxHp: 11,
    abilities: { str: 14, dex: 10, con: 13, int: 10, wis: 16, cha: 12 },
    attacks: [{ name: "Mace", toHit: 4, damage: "1d6+2", type: "bludgeoning" }], proficiency: 2,
    saves: ["wis", "cha"], skills: ["insight", "medicine"], slots: { 1: 2 }, hitDice: { die: 8, count: 1 } },
  { ref: "pc.wizard", name: "Oren", side: "pc", ac: 12, maxHp: 8,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    attacks: [{ name: "Fire Bolt", toHit: 5, damage: "1d10", type: "fire", kind: "ranged" }], proficiency: 2,
    saves: ["int", "wis"], skills: ["arcana", "investigation"], slots: { 1: 2 }, hitDice: { die: 6, count: 1 } },
];

/** Descriptive monster health — players never see numbers (decision 21 / §6). */
export function healthDescriptor(hp: number, maxHp: number): string {
  if (hp <= 0) return "down";
  const f = hp / maxHp;
  if (f > 0.75) return "unhurt";
  if (f > 0.5) return "scratched";
  if (f > 0.25) return "bloodied";
  return "staggering";
}
