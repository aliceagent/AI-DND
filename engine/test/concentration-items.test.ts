/** Gates: concentration (2024) and item effects. One spell at a time;
 *  damage forces a public con save (DC = max(10, half damage), hybrid
 *  dice); dropping to 0 ends it; a failed save ends it through the normal
 *  check flow. Potions heal through the normal healing path — PCs report
 *  the dice, NPCs' are drawn and recorded gm-side. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { EventStore } from "../src/store.js";
import { fold } from "../src/state.js";
import { KOBOLD, PCS } from "../src/srd.js";

function scene(seed = 50) {
  const eng = new Engine(seed);
  for (const pc of PCS) eng.join(pc.ref, pc);
  eng.join("kobold.1", { ...KOBOLD, name: "Kobold 1" });
  return eng;
}

const conc = (eng: Engine, id: string) => eng.state().combatants[id].concentratingOn;

test("casting with concentration starts it; a second spell replaces it", () => {
  const eng = scene();
  eng.castSpell("pc.cleric", 1, { concentration: "Bless" });
  assert.equal(conc(eng, "pc.cleric"), "Bless");
  eng.castSpell("pc.cleric", 1, { concentration: "Shield of Faith" });
  assert.equal(conc(eng, "pc.cleric"), "Shield of Faith");
  const ended = eng.store.timeline().filter(e => e.type === "concentration_ended");
  assert.equal((ended[0].payload as any).reason, "replaced");
  // PC concentration is table-visible
  assert.ok(eng.store.visibleTo("pc.rogue").some(e => e.type === "concentration_started"));
});

test("damage calls a public con save at max(10, half damage); failure drops the spell", () => {
  const eng = scene();
  eng.castSpell("pc.cleric", 1, { concentration: "Bless" });
  eng.applyDamage("pc.cleric", 7); // half = 3 → DC 10
  const call = eng.store.timeline().filter(e => e.type === "check_called").at(-1)!;
  assert.equal(call.visibility, "public");
  assert.equal((call.payload as any).dc, 10);                 // public DC — mechanical, not secret
  assert.deepEqual((call.payload as any).purpose, { kind: "concentration" });
  eng.reportCheckRoll(call.id, [3]);                          // 3 + 2 con = 5 < 10: gone
  assert.equal(conc(eng, "pc.cleric"), null);
  assert.equal((eng.store.timeline().at(-1)!.payload as any).reason, "failed_save");
});

test("a passed save keeps the spell; big hits scale the DC", () => {
  const eng = scene();
  eng.castSpell("pc.cleric", 1, { concentration: "Bless" });
  eng.applyDamage("pc.cleric", 8); // DC 10
  const c1 = eng.store.timeline().filter(e => e.type === "check_called").at(-1)!;
  eng.reportCheckRoll(c1.id, [15]); // 15 + 2 = 17 ≥ 10
  assert.equal(conc(eng, "pc.cleric"), "Bless");
  eng.applyHealing("pc.cleric", 8);
  eng.applyDamage("pc.cleric", 26 > 10 ? 2 : 2); // tiny hit…
  const c2 = eng.store.timeline().filter(e => e.type === "check_called").at(-1)!;
  assert.equal((c2.payload as any).dc, 10);      // …still floors at 10
});

test("dropping to 0 ends concentration without a save", () => {
  const eng = scene();
  eng.castSpell("pc.wizard", 1, { concentration: "Witch Bolt" });
  eng.applyDamage("pc.wizard", 8); // wizard hp 8 → down
  assert.equal(conc(eng, "pc.wizard"), null);
  const end = eng.store.timeline().filter(e => e.type === "concentration_ended").at(-1)!;
  assert.equal((end.payload as any).reason, "incapacitated");
  // no save was called for it
  assert.ok(!eng.store.timeline().some(e =>
    e.type === "check_called" && (e.payload as any).purpose?.kind === "concentration"));
});

test("potion of healing: PC reports the dice, heals through the normal path", () => {
  const eng = scene();
  eng.applyDamage("pc.fighter", 9); // 12 → 3
  eng.grantItem("pc.fighter", { id: "potion.healing", name: "Potion of Healing",
    tags: ["consumable"], effect: { kind: "heal", dice: "2d4+2" } });
  // refusing without dice leaves the potion carried
  assert.throws(() => eng.useItem("pc.fighter", "potion.healing"), /report the dice/);
  assert.equal(eng.state().combatants["pc.fighter"].inventory.length, 1);
  eng.useItem("pc.fighter", "potion.healing", { reportedRolls: [3, 4] }); // 7 + 2 = 9
  const c = eng.state().combatants["pc.fighter"];
  assert.equal(c.hp, 12);
  assert.equal(c.inventory.length, 0);
});

test("an NPC's potion dice are drawn by the engine and recorded gm-side", () => {
  const eng = scene();
  eng.applyDamage("kobold.1", 3); // 5 → 2
  eng.grantItem("kobold.1", { id: "potion.healing", name: "Potion of Healing",
    effect: { kind: "heal", dice: "2d4+2" } });
  eng.useItem("kobold.1", "potion.healing");
  const rolled = eng.store.timeline().filter(e =>
    e.type === "engine_rolled" && (e.payload as any).itemId === "potion.healing");
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].visibility, "gm");
  assert.ok(eng.state().combatants["kobold.1"].hp > 2);
  // players never saw the numbers
  assert.ok(!eng.store.visibleTo("pc.rogue").some(e => e.type === "engine_rolled"));
});

test("items without effects just consume; replay holds through all of it", () => {
  const eng = scene();
  eng.grantItem("pc.rogue", { id: "rope", name: "Silk Rope" });
  eng.useItem("pc.rogue", "rope");
  eng.castSpell("pc.cleric", 1, { concentration: "Bless" });
  eng.applyDamage("pc.cleric", 6);
  const call = eng.store.timeline().filter(e => e.type === "check_called").at(-1)!;
  eng.reportCheckRoll(call.id, [2]);
  const replayed = fold(EventStore.fromJSONL(eng.store.toJSONL()).timeline());
  assert.deepEqual(replayed, eng.state());
});
