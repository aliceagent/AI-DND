/** GameState is a pure fold over the event timeline. No randomness here —
 *  all rolled values live in event payloads. Same timeline ⇒ same state.
 *  fold() optionally starts from a snapshot (see store snapshots): folding
 *  the events after the snapshot's event id reproduces the full fold. */

import type { GameEvent } from "./store.js";
import { healthDescriptor } from "./srd.js";

export interface SlotPool { max: number; used: number }

export interface InventoryItem {
  id: string; name: string; tags?: string[];
  effect?: { kind: "heal"; dice: string };
}

export interface Combatant {
  id: string; statRef: string; name: string; side: "pc" | "npc";
  ac: number; hp: number; maxHp: number;
  conditions: string[];   // "unconscious", "dead", "prone", …
  initiative: number | null;
  deathSaves: { successes: number; failures: number };
  slots: Record<string, SlotPool>;          // spell slot level -> pool
  hitDice: { die: number; max: number; used: number } | null;
  level: number;
  inventory: InventoryItem[];
  portrait: string | null;                  // asset ref from portrait_attached
  concentratingOn: string | null;           // spell name, or null
}

export interface PendingCheck {
  id: number;             // event id of the check_called that opened it
  actor: string;
  kind: "check" | "save";
  ability: string;
  skill: string | null;
  advantage: "none" | "adv" | "dis";
  modifier: number;
  dc: number | null;      // set by the gm-visible companion event
  dcVisibility: "public" | "gm";
  rolls: number[] | null; // reported or engine-drawn d20s
  purpose: Record<string, unknown> | null; // e.g. {kind:"concentration"} — drives follow-ups
}

export interface SceneRef { locationId: string; name: string; mood: string | null; palette: string | null }

export interface GameState {
  combatants: Record<string, Combatant>;
  order: string[];        // initiative order, set on combat start
  round: number;
  turnIndex: number;
  combatOver: boolean;
  facts: Record<string, string[]>; // factId -> character ids it is revealed to ("*" = party)
  pendingChecks: Record<string, PendingCheck>;
  scene: SceneRef | null;            // where play is happening (party location)
  visitedLocations: string[];        // fog-of-visited for maps, in arrival order
  entityLocations: Record<string, string>; // entity id -> location id (entity_moved)
}

export const initialState = (): GameState =>
  ({ combatants: {}, order: [], round: 0, turnIndex: 0, combatOver: false, facts: {},
     pendingChecks: {}, scene: null, visitedLocations: [], entityLocations: {} });

export function reduce(s: GameState, e: GameEvent): GameState {
  const p = e.payload as any;
  switch (e.type) {
    case "combatant_joined":
    case "character_created": {
      const slots: Record<string, SlotPool> = {};
      for (const [lvl, max] of Object.entries(p.slots ?? {})) slots[lvl] = { max: max as number, used: 0 };
      s.combatants[p.id] = { id: p.id, statRef: p.statRef, name: p.name, side: p.side,
        ac: p.ac, hp: p.maxHp, maxHp: p.maxHp, conditions: [], initiative: null,
        deathSaves: { successes: 0, failures: 0 }, slots,
        hitDice: p.hitDice ? { die: p.hitDice.die, max: p.hitDice.count, used: 0 } : null,
        level: p.level ?? 1, inventory: [], portrait: null, concentratingOn: null };
      return s;
    }
    case "scene_set": {
      s.scene = { locationId: p.location_id, name: p.name,
        mood: p.mood ?? null, palette: p.palette ?? null };
      if (!s.visitedLocations.includes(p.location_id)) s.visitedLocations.push(p.location_id);
      return s;
    }
    case "entity_moved":
      s.entityLocations[p.entity_id] = p.to; return s;
    case "concentration_started":
      s.combatants[p.target].concentratingOn = p.spell; return s;
    case "concentration_ended":
      s.combatants[p.target].concentratingOn = null; return s;
    case "item_granted": {
      s.combatants[p.target].inventory.push(p.item);
      return s;
    }
    case "item_used": {
      const c = s.combatants[p.target];
      const i = c.inventory.findIndex(x => x.id === p.itemId);
      if (i >= 0) c.inventory.splice(i, 1);
      return s;
    }
    case "portrait_attached": {
      s.combatants[p.target].portrait = p.asset;
      return s;
    }
    case "level_up": {
      const c = s.combatants[p.target];
      c.level = p.level;
      c.maxHp += p.maxHpDelta;
      c.hp += p.maxHpDelta;
      if (p.slots) {
        const slots: Record<string, SlotPool> = {};
        for (const [lvl, max] of Object.entries(p.slots))
          slots[lvl] = { max: max as number, used: c.slots[lvl]?.used ?? 0 };
        c.slots = slots;
      }
      if (c.hitDice) c.hitDice.max = p.hitDiceCount;
      return s;
    }
    case "initiative_rolled":
      s.combatants[p.id].initiative = p.total; return s;
    case "combat_started":
      s.order = p.order; s.round = 1; s.turnIndex = 0; return s;
    case "turn_advanced":
      s.turnIndex = p.turnIndex; s.round = p.round; return s;
    case "damage_applied": {
      const c = s.combatants[p.target];
      const wasUp = c.hp > 0;
      c.hp = Math.max(0, c.hp - p.amount);
      if (wasUp && c.hp === 0) c.deathSaves = { successes: 0, failures: 0 };
      return s;
    }
    case "healing_applied": {
      const c = s.combatants[p.target];
      if (c.hp === 0 && p.amount > 0) c.deathSaves = { successes: 0, failures: 0 };
      c.hp = Math.min(c.maxHp, c.hp + p.amount);
      return s;
    }
    case "condition_changed": {
      const c = s.combatants[p.target];
      if (p.added && !c.conditions.includes(p.added)) c.conditions.push(p.added);
      if (p.removed) c.conditions = c.conditions.filter(x => x !== p.removed);
      if (p.added === "stable") c.deathSaves = { successes: 0, failures: 0 };
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
    // ---- checks & saves (hidden-DC flow): the public check_called opens the
    // pending check; the gm-visible companion (payload.checkId set) carries
    // the DC committed before any roll; check_resolved closes it.
    case "check_called": {
      if (p.checkId != null) {
        const pc = s.pendingChecks[p.checkId];
        if (pc) { pc.dc = p.dc; pc.dcVisibility = p.dcVisibility ?? "gm"; }
      } else {
        s.pendingChecks[e.id] = { id: e.id, actor: p.actor, kind: p.kind,
          ability: p.ability, skill: p.skill ?? null, advantage: p.advantage ?? "none",
          modifier: p.modifier, dc: p.dc ?? null,
          dcVisibility: p.dc != null ? (p.dcVisibility ?? "public") : "gm", rolls: null,
          purpose: p.purpose ?? null };
      }
      return s;
    }
    case "roll_reported": {
      if (p.checkId != null && s.pendingChecks[p.checkId]) s.pendingChecks[p.checkId].rolls = p.rolls;
      return s;
    }
    case "engine_rolled": {
      if (p.checkId != null && s.pendingChecks[p.checkId]) s.pendingChecks[p.checkId].rolls = p.rolls;
      return s;
    }
    case "check_resolved": {
      if (p.checkId != null) delete s.pendingChecks[p.checkId];
      return s;
    }
    case "death_save_recorded": {
      const c = s.combatants[p.target];
      if (p.result === "success") c.deathSaves.successes += p.count ?? 1;
      else c.deathSaves.failures += p.count ?? 1;
      return s;
    }
    case "slot_spent": {
      const pool = s.combatants[p.caster].slots[p.level];
      if (pool) pool.used += 1;
      return s;
    }
    case "hit_die_spent": {
      const c = s.combatants[p.target];
      if (c.hitDice) c.hitDice.used += 1;
      return s;
    }
    case "downtime_applied": {
      if (p.rest !== "long") return s;
      for (const id of p.participants as string[]) {
        const c = s.combatants[id];
        if (!c || c.conditions.includes("dead")) continue;
        c.hp = c.maxHp;
        c.deathSaves = { successes: 0, failures: 0 };
        for (const pool of Object.values(c.slots)) pool.used = 0;
        if (c.hitDice) c.hitDice.used = Math.max(0, c.hitDice.used - Math.max(1, Math.floor(c.hitDice.max / 2)));
        c.conditions = c.conditions.filter(x => x !== "unconscious" && x !== "stable");
      }
      return s;
    }
    default:
      return s; // declarations, roll reports, etc. carry no state delta themselves
  }
}

export function fold(events: GameEvent[], from?: GameState): GameState {
  return events.reduce(reduce, from ?? initialState());
}

export const activeOnSide = (s: GameState, side: "pc" | "npc") =>
  Object.values(s.combatants).filter(c => c.side === side &&
    !c.conditions.includes("dead") && !c.conditions.includes("unconscious"));

export const describe = (c: Combatant) =>
  c.side === "npc" ? `${c.name} (${healthDescriptor(c.hp, c.maxHp)})`
                   : `${c.name} (${c.hp}/${c.maxHp})`;
