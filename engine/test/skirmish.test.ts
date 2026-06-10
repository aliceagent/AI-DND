/** Phase 1 exit test — the gate from the build plan:
 *  "a scripted skirmish (four PCs vs. eight kobolds) runs to completion
 *   deterministically from a seed; replaying the log reproduces it exactly."
 *  Plus: visibility invariants (no monster numbers leak) and rewind-as-rebranch. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { EventStore } from "../src/store.js";
import { fold, activeOnSide } from "../src/state.js";
import { KOBOLD, PCS, type StatBlock } from "../src/srd.js";
import { mulberry32, rollDice, rollD20 } from "../src/rng.js";

const STATS: Record<string, StatBlock> = { "srd.kobold": KOBOLD };
for (const pc of PCS) STATS[pc.ref] = pc;

/** Run the full scripted skirmish. `tableSeed` drives the simulated players'
 *  physical dice (the report path); `engineSeed` drives NPC/secret rolls. */
function runSkirmish(engineSeed: number, tableSeed: number) {
  const eng = new Engine(engineSeed);
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
        // Simulate the player rolling physical dice and reporting them.
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

test("skirmish terminates with a winner", () => {
  const eng = runSkirmish(1234, 5678);
  const s = eng.state();
  assert.equal(s.combatOver, true);
  const ended = eng.store.timeline().find(e => e.type === "combat_ended")!;
  assert.ok(["pc", "npc"].includes((ended.payload as any).winner));
});

test("determinism: same seeds ⇒ byte-identical event logs", () => {
  const a = runSkirmish(42, 99).store.toJSONL();
  const b = runSkirmish(42, 99).store.toJSONL();
  assert.equal(a, b);
  const c = runSkirmish(43, 99).store.toJSONL();
  assert.notEqual(a, c); // and the seed actually matters
});

test("replay: folding the serialized log reproduces final state exactly", () => {
  const eng = runSkirmish(7, 11);
  const live = eng.state();
  const replayed = fold(EventStore.fromJSONL(eng.store.toJSONL()).timeline());
  assert.deepEqual(replayed, live);
});

test("visibility: monster numbers never reach a player view", () => {
  const eng = runSkirmish(2024, 2025);
  for (const pc of PCS) {
    const view = eng.store.visibleTo(pc.ref);
    for (const e of view) {
      // no gm-only event types at all
      assert.ok(!["engine_rolled", "branch_created"].includes(e.type),
        `${pc.ref} saw ${e.type}`);
      // no numeric damage to NPCs, no NPC initiative or NPC sheet numbers
      if (e.type === "damage_applied")
        assert.ok((e.payload as any).target === pc.ref, "saw another's damage number");
      if (e.type === "initiative_rolled")
        assert.ok(!String((e.payload as any).id).startsWith("kobold"), "saw NPC initiative");
      if (e.type === "combatant_joined")
        assert.ok((e.payload as any).side === "pc", "saw NPC stat numbers");
    }
    // but the player DOES see the descriptive tier changes
    assert.ok(view.some(e => e.type === "health_tier_changed" || e.type === "combat_ended"));
  }
});

test("rewind-as-rebranch: state rewinds, history is retained, branches diverge", () => {
  const eng = runSkirmish(555, 777);
  const timeline = eng.store.timeline();
  const mid = timeline[Math.floor(timeline.length / 2)];
  const stateAtEnd = JSON.stringify(eng.state());

  eng.rewindTo(mid.id, "xcard-1");
  const rewound = eng.state();
  assert.equal(rewound.combatOver, false, "rewound state should be mid-fight");

  // play differently on the new branch: the fighter attacks a different kobold
  const foes = activeOnSide(rewound, "npc");
  assert.ok(foes.length >= 2);
  eng.pcAttack("pc.fighter", foes[foes.length - 1].id,
    PCS[0].attacks[0], 20, [8]); // a reported nat 20
  const diverged = JSON.stringify(eng.state());
  assert.notEqual(diverged, stateAtEnd);

  // original branch's events still exist in the raw log (auditability)
  const raw = eng.store.toJSONL();
  assert.ok(raw.includes('"branch":"main"') && raw.includes('"branch":"xcard-1"'));
});
