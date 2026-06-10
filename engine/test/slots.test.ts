/** Gate: spell slots and rests. The engine — never the model — is the
 *  bookkeeper: casting without a slot throws. Slot accounting is the
 *  caster's private sheet data; long rests restore, hit dice heal on
 *  short rests with the player's reported roll. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./helpers.js";

test("slots spend down and run out", () => {
  const eng = scene();
  eng.castSpell("pc.cleric", 1);
  eng.castSpell("pc.cleric", 1);
  assert.deepEqual(eng.state().combatants["pc.cleric"].slots["1"], { max: 2, used: 2 });
  assert.throws(() => eng.castSpell("pc.cleric", 1), /no level-1 slot/);
  assert.throws(() => eng.castSpell("pc.cleric", 2), /no level-2 slot/);
  // the wizard's pool is untouched
  assert.deepEqual(eng.state().combatants["pc.wizard"].slots["1"], { max: 2, used: 0 });
});

test("slot accounting is private to the caster", () => {
  const eng = scene();
  eng.castSpell("pc.wizard", 1);
  const own = eng.store.visibleTo("pc.wizard").filter(e => e.type === "slot_spent");
  assert.equal(own.length, 1);
  assert.equal((own[0].payload as any).remaining, 1);
  for (const other of ["pc.fighter", "pc.rogue", "pc.cleric"])
    assert.equal(eng.store.visibleTo(other).filter(e => e.type === "slot_spent").length, 0,
      `${other} saw the wizard's slots`);
});

test("a martial has no slots at all", () => {
  const eng = scene();
  assert.throws(() => eng.castSpell("pc.fighter", 1), /no level-1 slot/);
});

test("long rest restores hp, slots, and the dying", () => {
  const eng = scene();
  eng.castSpell("pc.wizard", 1);
  eng.castSpell("pc.wizard", 1);
  eng.applyDamage("pc.rogue", 4);
  eng.applyDamage("pc.fighter", 12);          // dying
  eng.rest("long", ["pc.fighter", "pc.rogue", "pc.cleric", "pc.wizard"]);
  const s = eng.state();
  assert.equal(s.combatants["pc.rogue"].hp, 9);
  assert.equal(s.combatants["pc.fighter"].hp, 12);
  assert.ok(!s.combatants["pc.fighter"].conditions.includes("unconscious"));
  assert.deepEqual(s.combatants["pc.fighter"].deathSaves, { successes: 0, failures: 0 });
  assert.deepEqual(s.combatants["pc.wizard"].slots["1"], { max: 2, used: 0 });
});

test("the dead do not long-rest back", () => {
  const eng = scene();
  eng.applyDamage("pc.wizard", 16); // massive: dead
  eng.rest("long", ["pc.wizard"]);
  const c = eng.state().combatants["pc.wizard"];
  assert.equal(c.hp, 0);
  assert.ok(c.conditions.includes("dead"));
});

test("short rest: hit dice heal by the reported roll, then run out", () => {
  const eng = scene();
  eng.applyDamage("pc.fighter", 5);
  eng.rest("short", ["pc.fighter"]);
  eng.spendHitDie("pc.fighter", 6);           // 6 + 2 con = 8, capped at max
  const c = eng.state().combatants["pc.fighter"];
  assert.equal(c.hp, 12);
  assert.equal(c.hitDice!.used, 1);
  assert.throws(() => eng.spendHitDie("pc.fighter", 4), /no hit dice/);
});

test("hit dice come back on a long rest", () => {
  const eng = scene();
  eng.applyDamage("pc.fighter", 5);
  eng.spendHitDie("pc.fighter", 3);
  assert.equal(eng.state().combatants["pc.fighter"].hitDice!.used, 1);
  eng.rest("long", ["pc.fighter"]);
  assert.equal(eng.state().combatants["pc.fighter"].hitDice!.used, 0);
});
