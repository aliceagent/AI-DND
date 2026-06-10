/** Shared scenario runner for the new gate tests. skirmish.test.ts keeps its
 *  own copy on purpose — the original five gates stay self-contained. */

import { Engine } from "../src/engine.js";
import type { IEventStore } from "../src/store.js";
import { fold, activeOnSide } from "../src/state.js";
import { KOBOLD, PCS, type StatBlock } from "../src/srd.js";
import { mulberry32, rollDice, rollD20 } from "../src/rng.js";

export const STATS: Record<string, StatBlock> = { "srd.kobold": KOBOLD };
for (const pc of PCS) STATS[pc.ref] = pc;

/** The Phase-1 skirmish, parameterized over the event store. */
export function runSkirmish(engineSeed: number, tableSeed: number, store?: IEventStore): Engine {
  const eng = store ? new Engine(engineSeed, store) : new Engine(engineSeed);
  const table = mulberry32(tableSeed); // the players' dice on the table

  for (const pc of PCS) eng.join(pc.ref, pc);
  for (let i = 1; i <= 8; i++) eng.join(`kobold.${i}`, { ...KOBOLD, name: `Kobold ${i}` });
  eng.rollInitiativeAll(STATS);

  let active = eng.state().order[0];
  for (let guard = 0; guard < 500 && !eng.state().combatOver; guard++) {
    const s = eng.state();
    const me = s.combatants[active];
    const foes = activeOnSide(s, me.side === "pc" ? "npc" : "pc");
    if (foes.length) {
      const target = foes[0];
      const atk = STATS[me.statRef].attacks[0];
      if (me.side === "pc") {
        const d20 = rollD20(table, "none").kept;
        const dmg = rollDice(atk.damage, table);
        eng.pcAttack(me.id, target.id, atk, d20, dmg.rolls);
      } else {
        eng.npcAttack(me.id, target.id, atk);
      }
    }
    const next = eng.advanceTurn();
    if (!next) break;
    active = next;
  }
  return eng;
}

/** A small standing scene: four PCs + n kobolds, no initiative yet. */
export function scene(seed = 99, store?: IEventStore, kobolds = 1): Engine {
  const eng = store ? new Engine(seed, store) : new Engine(seed);
  for (const pc of PCS) eng.join(pc.ref, pc);
  for (let i = 1; i <= kobolds; i++) eng.join(`kobold.${i}`, { ...KOBOLD, name: `Kobold ${i}` });
  return eng;
}

export { fold };
