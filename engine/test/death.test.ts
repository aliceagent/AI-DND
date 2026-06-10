/** Gate: death saves. Dropping to 0 knocks a PC unconscious (dying); death
 *  saves are reported player rolls (public table drama, DC 10); three
 *  failures kill, three successes stabilize, nat 20 stands you up at 1 hp,
 *  nat 1 counts double, damage while down is a failure (massive = death). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./helpers.js";

const fighter = "pc.fighter";
const saves = (eng: ReturnType<typeof scene>) => eng.state().combatants[fighter].deathSaves;
const conds = (eng: ReturnType<typeof scene>) => eng.state().combatants[fighter].conditions;

const drop = (eng: ReturnType<typeof scene>) => eng.applyDamage(fighter, 12); // exactly max hp

test("dropping to 0 makes a PC unconscious, not dead", () => {
  const eng = scene();
  drop(eng);
  assert.equal(eng.state().combatants[fighter].hp, 0);
  assert.ok(conds(eng).includes("unconscious"));
  assert.ok(!conds(eng).includes("dead"));
});

test("three failures: dead", () => {
  const eng = scene();
  drop(eng);
  eng.deathSave(fighter, 9);
  eng.deathSave(fighter, 4);
  assert.deepEqual(saves(eng), { successes: 0, failures: 2 });
  eng.deathSave(fighter, 7);
  assert.ok(conds(eng).includes("dead"));
  assert.ok(!conds(eng).includes("unconscious"));
});

test("three successes: stable, and no further saves are rolled", () => {
  const eng = scene();
  drop(eng);
  eng.deathSave(fighter, 10); // 10 meets DC 10
  eng.deathSave(fighter, 14);
  eng.deathSave(fighter, 19);
  assert.ok(conds(eng).includes("stable"));
  assert.throws(() => eng.deathSave(fighter, 12), /not rolling death saves/);
});

test("nat 1 is two failures; nat 20 stands you up at 1 hp", () => {
  const eng = scene();
  drop(eng);
  eng.deathSave(fighter, 1);
  assert.deepEqual(saves(eng), { successes: 0, failures: 2 });
  eng.deathSave(fighter, 20);
  const c = eng.state().combatants[fighter];
  assert.equal(c.hp, 1);
  assert.ok(!c.conditions.includes("unconscious"));
  assert.deepEqual(c.deathSaves, { successes: 0, failures: 0 }); // healing resets the count
});

test("damage while dying: one failure, two on a crit, instant death if massive", () => {
  const eng = scene();
  drop(eng);
  eng.applyDamage(fighter, 3);
  assert.deepEqual(saves(eng), { successes: 0, failures: 1 });
  eng.applyDamage(fighter, 3, undefined, { crit: true });
  assert.deepEqual(saves(eng), { successes: 0, failures: 3 });
  assert.ok(conds(eng).includes("dead"));

  const eng2 = scene();
  drop(eng2);
  eng2.applyDamage(fighter, 12); // ≥ max hp while at 0
  assert.ok(eng2.state().combatants[fighter].conditions.includes("dead"));
});

test("massive damage from full health kills outright", () => {
  const eng = scene();
  eng.applyDamage("pc.wizard", 16); // 8 hp, 8 max: excess ≥ max
  assert.ok(eng.state().combatants["pc.wizard"].conditions.includes("dead"));
});

test("healing wakes the dying and resets the count", () => {
  const eng = scene();
  drop(eng);
  eng.deathSave(fighter, 6);
  eng.applyHealing(fighter, 5);
  const c = eng.state().combatants[fighter];
  assert.equal(c.hp, 5);
  assert.ok(!c.conditions.includes("unconscious"));
  assert.deepEqual(c.deathSaves, { successes: 0, failures: 0 });
});

test("damage to a stable PC re-opens the dying clock", () => {
  const eng = scene();
  drop(eng);
  eng.deathSave(fighter, 12); eng.deathSave(fighter, 12); eng.deathSave(fighter, 12);
  assert.ok(conds(eng).includes("stable"));
  eng.applyDamage(fighter, 2);
  assert.ok(!conds(eng).includes("stable"));
  assert.deepEqual(saves(eng), { successes: 0, failures: 1 });
});

test("death saves are public; the table sees the drama", () => {
  const eng = scene();
  drop(eng);
  eng.deathSave(fighter, 9);
  const view = eng.store.visibleTo("pc.rogue"); // another player's Box
  assert.ok(view.some(e => e.type === "death_save_recorded"));
});
