/** Deterministic RNG + dice. Every random draw the engine makes is recorded
 *  in the event payload, so replay folds events without re-drawing —
 *  determinism by construction, not by careful re-seeding. */

export type Rng = { next(): number; d(sides: number): number };

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, d: (sides: number) => Math.floor(next() * sides) + 1 };
}

export interface DiceResult { expr: string; rolls: number[]; modifier: number; total: number }

/** Parse and roll "2d6+3", "1d20", "d8-1". */
export function rollDice(expr: string, rng: Rng): DiceResult {
  const m = expr.replace(/\s/g, "").match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) throw new Error(`bad dice expr: ${expr}`);
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  const rolls = Array.from({ length: n }, () => rng.d(sides));
  return { expr, rolls, modifier, total: rolls.reduce((a, b) => a + b, 0) + modifier };
}

export type Advantage = "none" | "adv" | "dis";

export interface D20Result { rolls: number[]; kept: number; advantage: Advantage }

export function rollD20(rng: Rng, advantage: Advantage): D20Result {
  if (advantage === "none") { const r = rng.d(20); return { rolls: [r], kept: r, advantage }; }
  const a = rng.d(20), b = rng.d(20);
  return { rolls: [a, b], kept: advantage === "adv" ? Math.max(a, b) : Math.min(a, b), advantage };
}
