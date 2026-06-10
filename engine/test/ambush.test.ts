/** The second scripted scenario (mac-week §2 exit): a kobold ambush played
 *  end-to-end on the production SQLite store — secret stealth vs passive
 *  perception, the 2024 surprise rule, hidden-DC checks, conditions in
 *  anger, a PC down and saved, slots and a long rest — deterministic,
 *  replayable, and leak-audited like the original skirmish gate. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { EventStore } from "../src/store.js";
import { SqliteEventStore } from "../src/sqlite.js";
import { fold } from "../src/state.js";
import { KOBOLD, PCS } from "../src/srd.js";

const PARTY = PCS.map(pc => pc.ref);

function runAmbush(engineSeed: number): Engine {
  const eng = new Engine(engineSeed, new SqliteEventStore());
  for (const pc of PCS) eng.join(pc.ref, pc);
  for (let i = 1; i <= 3; i++) eng.join(`kobold.${i}`, { ...KOBOLD, name: `Kobold ${i}` });

  // The kobolds lie in wait: a secret group stealth roll the table never sees,
  // tested against each PC's passive Perception (also never surfaced).
  const hide = eng.engineCheck({ actor: "kobold.1", kind: "check", ability: "dex", skill: "stealth", dc: 13 });
  const surprised = hide.outcome === "success"
    ? PARTY.filter(id => eng.passiveCheck(id, "perception", 15).outcome === "failure")
    : [];

  // 2024 surprise: disadvantage on initiative, never a lost round.
  eng.rollInitiativeAll({}, surprised);

  // Opening volley: a kobold nets the rogue (restrained), another knocks the
  // fighter prone, the third stabs the downed-soon wizard.
  eng.setCondition("pc.rogue", { add: "restrained" });
  eng.setCondition("pc.fighter", { add: "prone" });
  eng.npcAttack("kobold.1", "pc.rogue", KOBOLD.attacks[0]);       // adv: restrained target
  eng.npcAttack("kobold.2", "pc.fighter", KOBOLD.attacks[0]);     // adv: prone target, melee

  // The rogue cuts free — Dexterity (Acrobatics) against a DC the table
  // never learns, rolled on the table and reported.
  const escape = eng.callCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "acrobatics", dc: 12 });
  eng.reportCheckRoll(escape, [13]); // 13 + 5 = 18: free
  eng.setCondition("pc.rogue", { remove: "restrained" });

  // The wizard burns a slot, fells a kobold, takes the reprisal and drops.
  eng.castSpell("pc.wizard", 1);
  eng.pcAttack("pc.wizard", "kobold.3", PCS[3].attacks[0], 17, [9]); // 9 + nothing: kobold (5 hp) down
  eng.applyDamage("pc.wizard", 9);                                   // dropped, dying
  assert.ok(eng.state().combatants["pc.wizard"].conditions.includes("unconscious"));

  // A frightened cleric (dragon-cult war cry) still has to save her friend:
  // Wisdom (Medicine) at disadvantage, hidden DC.
  eng.setCondition("pc.cleric", { add: "frightened" });
  const firstAid = eng.callCheck({ actor: "pc.cleric", kind: "check", ability: "wis", skill: "medicine", dc: 10 });
  eng.reportCheckRoll(firstAid, [4, 11]); // disadvantage keeps the 4: 4 + 5 = 9, fail
  eng.deathSave("pc.wizard", 9);          // one failure
  eng.deathSave("pc.wizard", 15);         // one success
  eng.castSpell("pc.cleric", 1);          // Healing Word
  eng.applyHealing("pc.wizard", 4);       // back up, count reset

  // The party rallies and ends it.
  eng.setCondition("pc.cleric", { remove: "frightened" });
  eng.pcAttack("pc.fighter", "kobold.1", PCS[0].attacks[0], 18, [7]);
  eng.pcAttack("pc.rogue", "kobold.2", PCS[1].attacks[0], 19, [6]);
  assert.equal(eng.state().combatOver, true);

  // Camp. Slots and hp come back; the log remembers everything.
  eng.rest("long", PARTY);
  return eng;
}

test("the ambush runs end-to-end and the night ends whole", () => {
  const eng = runAmbush(404);
  const s = eng.state();
  assert.equal((eng.store.timeline().find(e => e.type === "combat_ended")!.payload as any).winner, "pc");
  for (const id of PARTY) {
    assert.equal(s.combatants[id].hp, s.combatants[id].maxHp, `${id} not healed`);
    assert.deepEqual(s.combatants[id].deathSaves, { successes: 0, failures: 0 });
    for (const pool of Object.values(s.combatants[id].slots))
      assert.equal(pool.used, 0, `${id} slots not restored`);
  }
});

test("determinism: same seed ⇒ byte-identical ambush logs", () => {
  assert.equal(runAmbush(42).store.toJSONL(), runAmbush(42).store.toJSONL());
  assert.notEqual(runAmbush(42).store.toJSONL(), runAmbush(43).store.toJSONL());
});

test("replay: the serialized ambush folds back to the live state", () => {
  const eng = runAmbush(7);
  assert.deepEqual(fold(EventStore.fromJSONL(eng.store.toJSONL()).timeline()), eng.state());
});

test("leak audit: no DC, no secret roll, no slot of another, in any Box view", () => {
  const eng = runAmbush(2026);
  for (const id of PARTY) {
    const view = eng.store.visibleTo(id);
    const raw = JSON.stringify(view);
    assert.ok(!raw.includes('"dc"'), `${id} saw a DC`);
    for (const e of view) {
      assert.ok(!["engine_rolled", "branch_created"].includes(e.type), `${id} saw ${e.type}`);
      assert.ok((e.payload as any).method !== "passive", `${id} saw a passive check`);
      if (e.type === "slot_spent")
        assert.equal((e.payload as any).caster, id, `${id} saw another's slots`);
      if (e.type === "damage_applied" || e.type === "healing_applied")
        assert.equal((e.payload as any).target, id, `${id} saw another's hp math`);
      if (e.type === "combatant_joined")
        assert.equal((e.payload as any).id, id, `${id} saw another sheet`);
    }
    // but the shared fiction is all there
    assert.ok(view.some(e => e.type === "check_called"), `${id} missed the check calls`);
    assert.ok(view.some(e => e.type === "death_save_recorded"), `${id} missed the dying drama`);
    assert.ok(view.some(e => e.type === "combat_ended"));
  }
});
