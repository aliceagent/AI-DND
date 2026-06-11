/** Gate: the SRD 5.2 character model. The engine is the legality authority
 *  (illegal builds throw before any event lands); derived numbers are
 *  computed from the build against hand-checked goldens; a created
 *  character is a first-class combatant (fights, replays, rewinds). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { EventStore } from "../src/store.js";
import { fold } from "../src/state.js";
import { KOBOLD } from "../src/srd.js";
import { derive, validateBuild, type CharacterBuild } from "../src/character.js";

/** A hand-checked fighter: soldier background +2 str / +1 con. */
const KAEL: CharacterBuild = {
  id: "pc.kael2", name: "Kael", species: "human", class: "fighter", background: "soldier",
  abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 }, // standard array
  abilityBonus: { str: 2, con: 1 },
  skills: ["perception", "survival"], // athletics/intimidation come from soldier
};

const SAGE_WIZARD: CharacterBuild = {
  id: "pc.oren2", name: "Oren", species: "elf", class: "wizard", background: "sage",
  abilities: { str: 8, dex: 14, con: 12, int: 15, wis: 13, cha: 10 },
  abilityBonus: { int: 2, con: 1 },
  skills: ["investigation", "insight"],
};

test("derive: hand-checked golden sheet (fighter/soldier)", () => {
  const s = derive(KAEL);
  assert.equal(s.finalAbilities.str, 16);          // 14 + 2 background
  assert.equal(s.finalAbilities.con, 14);          // 13 + 1
  assert.equal(s.maxHp, 12);                       // d10 max + con mod 2
  assert.equal(s.ac, 16);                          // chain mail, no dex
  assert.deepEqual(s.saves, ["str", "con"]);
  assert.deepEqual(s.skills, ["athletics", "intimidation", "perception", "survival"]);
  assert.equal(s.attacks[0].toHit, 5);             // prof 2 + str 3
  assert.equal(s.attacks[0].damage, "1d8+3");
  assert.equal(s.passivePerception, 14);           // 10 + wis 2 + prof 2
  assert.equal(s.hitDice?.die, 10);
});

test("derive: caster sheet gets slots; leather AC uses dex", () => {
  const s = derive(SAGE_WIZARD);
  assert.equal(s.maxHp, 7);                        // d6 + con 1
  assert.deepEqual(s.slots, { 1: 2 });
  assert.equal(s.ac, 12);                          // unarmored 10 + dex 2
  assert.equal(s.attacks[0].kind, "ranged");
  assert.equal(s.attacks[0].toHit, 5);             // prof 2 + int 3 (15+2=17)
});

test("illegal builds throw: the engine is the authority", () => {
  const t = (mut: Partial<CharacterBuild>, re: RegExp) =>
    assert.throws(() => validateBuild({ ...KAEL, ...mut }), re);
  t({ species: "dragonborn" }, /unknown species/);
  t({ abilities: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } }, /point-buy cost/);
  t({ abilities: { str: 18, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }, /8-15/);
  t({ abilityBonus: { str: 2, wis: 1 } }, /not allowed by background/);   // wis not soldier's
  t({ abilityBonus: { str: 3 } }, /\+2\/\+1/);
  t({ skills: ["perception"] }, /exactly 2/);
  t({ skills: ["stealth", "perception"] }, /not a fighter skill/);
  t({ skills: ["athletics", "intimidation"] }, /already proficient/);     // intimidation is soldier's
  t({ skills: ["athletics", "athletics"] }, /already|duplicate/);
});

test("point buy: a legal 27-point spread validates", () => {
  validateBuild({ ...KAEL, abilities: { str: 15, dex: 12, con: 14, int: 8, wis: 12, cha: 9 } }); // 9+4+7+0+4+1=25
});

test("createCharacter: events land, sheet is private, character fights", () => {
  const eng = new Engine(7);
  const sheet = eng.createCharacter(KAEL);
  assert.equal(sheet.maxHp, 12);
  // sheet event is visible only to the owner
  const created = eng.store.timeline().find(e => e.type === "character_created")!;
  assert.deepEqual(created.visibility, ["pc.kael2"]);
  // duplicate id refused
  assert.throws(() => eng.createCharacter(KAEL), /id taken/);
  // and the character is a real combatant: fights a kobold
  eng.join("kobold.1", { ...KOBOLD, name: "Kobold 1" });
  eng.pcAttack("pc.kael2", "kobold.1", sheet.attacks[0], 15, [6]);
  assert.ok(eng.state().combatants["kobold.1"].conditions.includes("dead")); // 6+3 ≥ 5 hp
  // …and checks use the build's proficiencies
  const id = eng.callCheck({ actor: "pc.kael2", kind: "check", ability: "wis", skill: "perception", dc: 10 });
  const called = eng.store.timeline().find(e => e.id === id)!;
  assert.equal((called.payload as any).modifier, 4); // wis 2 + prof 2
});

test("inventory: grant folds in, use consumes, using what you lack throws", () => {
  const eng = new Engine(8);
  eng.createCharacter(KAEL);
  eng.grantItem("pc.kael2", { id: "potion.healing", name: "Potion of Healing", tags: ["consumable"] });
  eng.grantItem("pc.kael2", { id: "rope.silk", name: "Silk Rope" });
  assert.equal(eng.state().combatants["pc.kael2"].inventory.length, 2);
  eng.useItem("pc.kael2", "potion.healing");
  assert.deepEqual(eng.state().combatants["pc.kael2"].inventory.map(i => i.id), ["rope.silk"]);
  assert.throws(() => eng.useItem("pc.kael2", "potion.healing"), /does not carry/);
  // inventory events are owner-private
  for (const e of eng.store.timeline().filter(e => e.type.startsWith("item_")))
    assert.deepEqual(e.visibility, ["pc.kael2"]);
});

test("backstory is private; the portrait moment is public", () => {
  const eng = new Engine(9);
  eng.createCharacter(KAEL);
  eng.recordBackstory("pc.kael2", "I held the bridge at Marlow ford so the carts could cross.");
  eng.attachPortrait("pc.kael2", "sha256:abc123", "16:9 portrait prompt …");
  const back = eng.store.timeline().find(e => e.type === "backstory_recorded")!;
  const port = eng.store.timeline().find(e => e.type === "portrait_attached")!;
  assert.deepEqual(back.visibility, ["pc.kael2"]);
  assert.equal(port.visibility, "public");
  assert.equal(eng.state().combatants["pc.kael2"].portrait, "sha256:abc123");
});

test("level up: validated, hp by average or reported roll, slots grow", () => {
  const eng = new Engine(10);
  eng.createCharacter(SAGE_WIZARD);
  eng.levelUp("pc.oren2", 2, { method: "average" }); // d6 avg 4 + con 1 = 5
  const c = eng.state().combatants["pc.oren2"];
  assert.equal(c.level, 2);
  assert.equal(c.maxHp, 12); // 7 + 5
  assert.deepEqual(c.slots["1"], { max: 3, used: 0 });
  assert.equal(c.hitDice?.max, 2);
  assert.throws(() => eng.levelUp("pc.oren2", 4, { method: "average" }), /illegal level-up/);
  const eng2 = new Engine(11);
  eng2.createCharacter(SAGE_WIZARD);
  assert.throws(() => eng2.levelUp("pc.oren2", 2, { method: "roll", reported: 9 }), /outside 1-6/);
  eng2.levelUp("pc.oren2", 2, { method: "roll", reported: 6 });
  assert.equal(eng2.state().combatants["pc.oren2"].maxHp, 14); // 7 + 6 + 1
});

test("replay: a created character round-trips the log byte-faithfully", () => {
  const eng = new Engine(12);
  eng.createCharacter(KAEL);
  eng.grantItem("pc.kael2", { id: "torch", name: "Torch" });
  eng.recordBackstory("pc.kael2", "Bridge. Ford. Carts.");
  eng.attachPortrait("pc.kael2", "sha256:def", "prompt");
  eng.levelUp("pc.kael2", 2, { method: "average" });
  const replayed = fold(EventStore.fromJSONL(eng.store.toJSONL()).timeline());
  assert.deepEqual(replayed, eng.state());
});
