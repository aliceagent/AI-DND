/** GameState is a pure fold over the event timeline. No randomness here —
 *  all rolled values live in event payloads. Same timeline ⇒ same state. */

import type { GameEvent } from "./store.js";
import { healthDescriptor } from "./srd.js";

export interface Combatant {
  id: string; statRef: string; name: string; side: "pc" | "npc";
  ac: number; hp: number; maxHp: number;
  conditions: string[];   // "unconscious", "dead", "prone", …
  initiative: number | null;
}

export interface GameState {
  combatants: Record<string, Combatant>;
  order: string[];        // initiative order, set on combat start
  round: number;
  turnIndex: number;
  combatOver: boolean;
  facts: Record<string, string[]>; // factId -> character ids it is revealed to ("*" = party)
}

export const initialState = (): GameState =>
  ({ combatants: {}, order: [], round: 0, turnIndex: 0, combatOver: false, facts: {} });

export function reduce(s: GameState, e: GameEvent): GameState {
  const p = e.payload as any;
  switch (e.type) {
    case "combatant_joined":
      s.combatants[p.id] = { id: p.id, statRef: p.statRef, name: p.name, side: p.side,
        ac: p.ac, hp: p.maxHp, maxHp: p.maxHp, conditions: [], initiative: null };
      return s;
    case "initiative_rolled":
      s.combatants[p.id].initiative = p.total; return s;
    case "combat_started":
      s.order = p.order; s.round = 1; s.turnIndex = 0; return s;
    case "turn_advanced":
      s.turnIndex = p.turnIndex; s.round = p.round; return s;
    case "damage_applied": {
      const c = s.combatants[p.target];
      c.hp = Math.max(0, c.hp - p.amount);
      return s;
    }
    case "condition_changed": {
      const c = s.combatants[p.target];
      if (p.added && !c.conditions.includes(p.added)) c.conditions.push(p.added);
      if (p.removed) c.conditions = c.conditions.filter(x => x !== p.removed);
      return s;
    }
    case "combat_ended":
      s.combatOver = true; return s;
    case "fact_revealed": {
      const list = (s.facts[p.factId] ??= []);
      const who = p.to === "party" ? "*" : p.to;
      for (const w of Array.isArray(who) ? who : [who]) if (!list.includes(w)) list.push(w);
      return s;
    }
    default:
      return s; // declarations, roll reports, etc. carry no state delta themselves
  }
}

export function fold(events: GameEvent[]): GameState {
  return events.reduce(reduce, initialState());
}

export const activeOnSide = (s: GameState, side: "pc" | "npc") =>
  Object.values(s.combatants).filter(c => c.side === side &&
    !c.conditions.includes("dead") && !c.conditions.includes("unconscious"));

export const describe = (c: Combatant) =>
  c.side === "npc" ? `${c.name} (${healthDescriptor(c.hp, c.maxHp)})`
                   : `${c.name} (${c.hp}/${c.maxHp})`;
