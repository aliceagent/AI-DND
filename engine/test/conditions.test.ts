/** Gate: conditions carry mechanical effects (prone, restrained, frightened,
 *  unconscious), folded into the *effective advantage recorded on the event*
 *  so replay never re-derives a rule. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./helpers.js";
import { KOBOLD } from "../src/srd.js";

const declared = (eng: ReturnType<typeof scene>) =>
  eng.store.timeline().filter(e => e.type === "attack_declared").at(-1)!.payload as any;

test("prone: melee attacks against gain advantage, ranged suffer disadvantage", () => {
  const eng = scene();
  eng.setCondition("kobold.1", { add: "prone" });
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 10, [4]); // melee default
  assert.equal(declared(eng).advantage, "adv");
  eng.pcAttack("pc.wizard", "kobold.1", { toHit: 5, damage: "1d10", kind: "ranged" }, 10, [4]);
  assert.equal(declared(eng).advantage, "dis");
});

test("prone attacker rolls at disadvantage; adv + dis cancel to a straight roll", () => {
  const eng = scene();
  eng.setCondition("kobold.1", { add: "prone" });
  // prone kobold (dis) attacks a prone fighter in melee (adv) — they cancel
  eng.setCondition("pc.fighter", { add: "prone" });
  eng.npcAttack("kobold.1", "pc.fighter", KOBOLD.attacks[0]);
  assert.equal(declared(eng).advantage, "none");
  const rolled = eng.store.timeline().filter(e => e.type === "engine_rolled").at(-1)!.payload as any;
  assert.equal(rolled.d20.length, 1); // straight roll, one die drawn
});

test("restrained: attacks against have advantage, own attacks and dex saves disadvantage", () => {
  const eng = scene();
  eng.setCondition("kobold.1", { add: "restrained" });
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 5, [4]); // miss — keep it alive
  assert.equal(declared(eng).advantage, "adv");
  eng.npcAttack("kobold.1", "pc.fighter", KOBOLD.attacks[0]);
  assert.equal(declared(eng).advantage, "dis");
  const rolled = eng.store.timeline().filter(e => e.type === "engine_rolled").at(-1)!.payload as any;
  assert.equal(rolled.d20.length, 2); // disadvantage draws two dice

  eng.setCondition("pc.rogue", { add: "restrained" });
  const id = eng.callCheck({ actor: "pc.rogue", kind: "save", ability: "dex", dc: 12 });
  assert.equal((eng.store.timeline().find(e => e.id === id)!.payload as any).advantage, "dis");
});

test("frightened: disadvantage on attacks and ability checks", () => {
  const eng = scene();
  eng.setCondition("pc.fighter", { add: "frightened" });
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 10, [4]);
  assert.equal(declared(eng).advantage, "dis");
  const id = eng.callCheck({ actor: "pc.fighter", kind: "check", ability: "str", skill: "athletics", dc: 10 });
  assert.equal((eng.store.timeline().find(e => e.id === id)!.payload as any).advantage, "dis");
  // frightened does NOT touch saving throws
  const save = eng.callCheck({ actor: "pc.fighter", kind: "save", ability: "con", dc: 10 });
  assert.equal((eng.store.timeline().find(e => e.id === save)!.payload as any).advantage, "none");
});

test("removing a condition removes its effect", () => {
  const eng = scene();
  eng.setCondition("kobold.1", { add: "prone" });
  eng.setCondition("kobold.1", { remove: "prone" });
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 10, [4]);
  assert.equal(declared(eng).advantage, "none");
});

test("melee hits on an unconscious target are critical", () => {
  const eng = scene();
  eng.setCondition("pc.fighter", { add: "unconscious" });
  eng.pcAttack("pc.rogue", "pc.fighter", { toHit: 5, damage: "1d6+3" }, 15, [4]); // 20 vs AC 16: hit
  const res = eng.store.timeline().filter(e => e.type === "attack_resolved").at(-1)!.payload as any;
  assert.equal(res.hit, true);
  assert.equal(res.crit, true); // auto-crit, not a nat 20
  const dmg = eng.store.timeline().filter(e => e.type === "damage_applied").at(-1)!.payload as any;
  assert.equal(dmg.amount, 11); // 4 doubled + 3
});

test("the dead cannot act", () => {
  const eng = scene();
  eng.applyDamage("kobold.1", 5); // kobolds at 0 are dead
  assert.throws(() => eng.npcAttack("kobold.1", "pc.fighter", KOBOLD.attacks[0]), /cannot act/);
});
