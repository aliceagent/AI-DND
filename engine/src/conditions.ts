/** Mechanical effects of conditions (SRD 5.2 / 2024 rules), as pure functions
 *  over folded state. The engine consults these when computing the effective
 *  advantage of a d20 test; the *result* is what gets recorded in the event,
 *  so replay never needs to re-derive anything here.
 *
 *  Scope (Episode 1 breadth): prone, restrained, frightened, unconscious.
 *  Simplifications, deliberate until positioning exists:
 *   - prone vs melee/ranged uses the attack's kind, not measured distance;
 *   - frightened applies always (line of sight to the fear source untracked).
 */

import type { Advantage } from "./rng.js";
import type { Combatant } from "./state.js";
import type { Ability } from "./srd.js";

export type AttackKind = "melee" | "ranged";

const has = (c: Combatant, cond: string) => c.conditions.includes(cond);

/** 2024 rule: any advantage + any disadvantage cancel to a straight roll,
 *  regardless of how many sources of each. */
export function combineAdvantage(parts: Advantage[]): Advantage {
  const adv = parts.includes("adv"), dis = parts.includes("dis");
  if (adv && dis) return "none";
  return adv ? "adv" : dis ? "dis" : "none";
}

/** Condition-derived advantage on an attack roll, both sides considered. */
export function attackFactors(attacker: Combatant, target: Combatant, kind: AttackKind): Advantage[] {
  const f: Advantage[] = [];
  if (has(attacker, "prone")) f.push("dis");
  if (has(attacker, "restrained")) f.push("dis");
  if (has(attacker, "frightened")) f.push("dis");
  if (has(target, "prone")) f.push(kind === "melee" ? "adv" : "dis");
  if (has(target, "restrained")) f.push("adv");
  if (has(target, "unconscious")) f.push("adv");
  return f;
}

/** Unconscious targets are crit by any melee hit. */
export function autoCrit(target: Combatant, kind: AttackKind): boolean {
  return kind === "melee" && has(target, "unconscious");
}

/** Condition-derived advantage on a saving throw. */
export function saveFactors(actor: Combatant, ability: Ability): Advantage[] {
  const f: Advantage[] = [];
  if (has(actor, "restrained") && ability === "dex") f.push("dis");
  return f;
}

/** Unconscious creatures automatically fail Strength and Dexterity saves. */
export function autoFailsSave(actor: Combatant, ability: Ability): boolean {
  return has(actor, "unconscious") && (ability === "str" || ability === "dex");
}

/** Condition-derived advantage on an ability check. */
export function checkFactors(actor: Combatant): Advantage[] {
  return has(actor, "frightened") ? ["dis"] : [];
}

/** A combatant who cannot take actions at all. */
export function cannotAct(c: Combatant): boolean {
  return has(c, "unconscious") || has(c, "dead");
}
