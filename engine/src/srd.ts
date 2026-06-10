/** SRD 5.2 (CC-BY-4.0) minimal data layer for the Phase 1 exit test.
 *  Production grows this into the full rules core; the shapes are final. */

export interface Abilities { str: number; dex: number; con: number; int: number; wis: number; cha: number }

export const mod = (score: number) => Math.floor((score - 10) / 2);

export interface AttackSpec { name: string; toHit: number; damage: string; type: string }

export interface StatBlock {
  ref: string;                // engine stat id, e.g. "srd.kobold"
  name: string;
  side: "pc" | "npc";
  ac: number;
  maxHp: number;
  abilities: Abilities;
  attacks: AttackSpec[];
  proficiency: number;
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
    attacks: [{ name: "Longsword", toHit: 5, damage: "1d8+3", type: "slashing" }], proficiency: 2 },
  { ref: "pc.rogue", name: "Vex", side: "pc", ac: 14, maxHp: 9,
    abilities: { str: 10, dex: 16, con: 12, int: 13, wis: 12, cha: 14 },
    attacks: [{ name: "Shortsword", toHit: 5, damage: "1d6+3", type: "piercing" }], proficiency: 2 },
  { ref: "pc.cleric", name: "Mara", side: "pc", ac: 16, maxHp: 11,
    abilities: { str: 14, dex: 10, con: 13, int: 10, wis: 16, cha: 12 },
    attacks: [{ name: "Mace", toHit: 4, damage: "1d6+2", type: "bludgeoning" }], proficiency: 2 },
  { ref: "pc.wizard", name: "Oren", side: "pc", ac: 12, maxHp: 8,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    attacks: [{ name: "Fire Bolt", toHit: 5, damage: "1d10", type: "fire" }], proficiency: 2 },
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
