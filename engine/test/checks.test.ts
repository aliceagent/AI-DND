/** Gate: checks & saves with the hidden-DC event flow
 *  (schemas/event.schema.json): check_called public without the DC,
 *  the DC committed gm-visible before any roll, roll_reported, and a
 *  check_resolved pair — gm with the DC, public without. A player view
 *  must never contain a DC. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./helpers.js";
import { PCS } from "../src/srd.js";

const noDcInView = (eng: ReturnType<typeof scene>, charId: string) =>
  assert.ok(!JSON.stringify(eng.store.visibleTo(charId)).includes('"dc"'),
    `${charId} can see a DC`);

test("hidden-DC flow: called without DC, committed gm-side, resolved both-sided", () => {
  const eng = scene();
  // Vex, Dexterity (Stealth): +3 dex, +2 proficiency = +5 (the schema example)
  const id = eng.callCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "stealth", dc: 12 });

  const tl = eng.store.timeline();
  const called = tl.find(e => e.id === id)!;
  assert.equal(called.type, "check_called");
  assert.equal(called.visibility, "public");
  assert.equal((called.payload as any).modifier, 5);       // roll pad pre-load
  assert.equal((called.payload as any).dc, undefined);     // no DC on the public call
  const committed = tl.find(e => e.type === "check_called" && (e.payload as any).checkId === id)!;
  assert.equal(committed.visibility, "gm");                // DC committed before the roll
  assert.equal((committed.payload as any).dc, 12);
  assert.equal(eng.state().pendingChecks[id].dc, 12);

  eng.reportCheckRoll(id, [14]);
  const reported = eng.store.timeline().find(e => e.type === "roll_reported" && (e.payload as any).checkId === id)!;
  assert.equal(reported.visibility, "public");
  assert.deepEqual((reported.payload as any).rolls, [14]);

  const resolved = eng.store.timeline().filter(e => e.type === "check_resolved" && (e.payload as any).checkId === id);
  assert.equal(resolved.length, 2);
  const gm = resolved.find(e => e.visibility === "gm")!;
  const pub = resolved.find(e => e.visibility === "public")!;
  assert.equal((gm.payload as any).dc, 12);
  assert.equal((gm.payload as any).dc_visibility, "gm");
  assert.equal((gm.payload as any).total, 19);
  assert.equal((gm.payload as any).outcome, "success");
  assert.equal((pub.payload as any).dc, undefined);        // outcome travels, DC doesn't
  assert.equal((pub.payload as any).outcome, "success");

  assert.equal(eng.state().pendingChecks[id], undefined);  // pending check closed
  for (const pc of PCS) noDcInView(eng, pc.ref);
});

test("public-DC check resolves in one public event carrying the DC", () => {
  const eng = scene();
  const id = eng.callCheck({ actor: "pc.fighter", kind: "check", ability: "str", skill: "athletics",
    dc: 10, dcVisibility: "public" });
  eng.reportCheckRoll(id, [3]); // 3 + 5 = 8 < 10
  const resolved = eng.store.timeline().filter(e => e.type === "check_resolved" && (e.payload as any).checkId === id);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].visibility, "public");
  assert.equal((resolved[0].payload as any).dc, 10);
  assert.equal((resolved[0].payload as any).outcome, "failure");
});

test("2024 d20 tests: nat 20 always succeeds, nat 1 always fails", () => {
  const eng = scene();
  const high = eng.callCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "stealth", dc: 30 });
  eng.reportCheckRoll(high, [20]);
  const low = eng.callCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "stealth", dc: 2 });
  eng.reportCheckRoll(low, [1]);
  const outcomes = eng.store.timeline()
    .filter(e => e.type === "check_resolved" && e.visibility === "gm")
    .map(e => (e.payload as any).outcome);
  assert.deepEqual(outcomes, ["success", "failure"]);
});

test("advantage: two reported dice, the right one kept", () => {
  const eng = scene();
  const adv = eng.callCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "acrobatics", dc: 15, advantage: "adv" });
  eng.reportCheckRoll(adv, [7, 15]);
  const dis = eng.callCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "acrobatics", dc: 15, advantage: "dis" });
  eng.reportCheckRoll(dis, [7, 15]);
  const kept = eng.store.timeline()
    .filter(e => e.type === "roll_reported" && (e.payload as any).checkId != null)
    .map(e => (e.payload as any).kept);
  assert.deepEqual(kept, [15, 7]);
});

test("saving throws use save proficiency", () => {
  const eng = scene();
  // Kael con save: +2 con, +2 proficiency = +4
  const id = eng.callCheck({ actor: "pc.fighter", kind: "save", ability: "con", dc: 13 });
  assert.equal((eng.store.timeline().find(e => e.id === id)!.payload as any).modifier, 4);
  eng.reportCheckRoll(id, [9]); // 9 + 4 = 13: meets it, beats it
  const gm = eng.store.timeline().find(e => e.type === "check_resolved" && e.visibility === "gm")!;
  assert.equal((gm.payload as any).outcome, "success");
});

test("engine (NPC/secret) checks never touch a player view", () => {
  const eng = scene();
  const before = PCS.map(pc => eng.store.visibleTo(pc.ref).length);
  const { outcome } = eng.engineCheck({ actor: "kobold.1", kind: "check", ability: "dex", skill: "stealth", dc: 13 });
  assert.ok(["success", "failure"].includes(outcome));
  PCS.forEach((pc, i) =>
    assert.equal(eng.store.visibleTo(pc.ref).length, before[i], `${pc.ref} saw a secret check`));
});

test("passive checks: gm-only, 10 + modifier, ±5 under adv/dis", () => {
  const eng = scene();
  const before = PCS.map(pc => eng.store.visibleTo(pc.ref).length);
  // Vex passive perception: 10 + 1 wis + 2 prof = 13
  assert.deepEqual(eng.passiveCheck("pc.rogue", "perception", 13), { score: 13, outcome: "success" });
  eng.setCondition("pc.rogue", { add: "frightened" });
  assert.deepEqual(eng.passiveCheck("pc.rogue", "perception", 13), { score: 8, outcome: "failure" });
  const passives = eng.store.timeline().filter(e => (e.payload as any).method === "passive");
  assert.equal(passives.length, 2);
  for (const e of passives) assert.equal(e.visibility, "gm");
  // the setCondition is public; the passive consultations are not
  PCS.forEach((pc, i) =>
    assert.equal(eng.store.visibleTo(pc.ref).length, before[i] + 1, `${pc.ref} saw a passive check`));
});

test("unconscious auto-fails str/dex saves without a roll", () => {
  const eng = scene();
  eng.setCondition("pc.fighter", { add: "unconscious" });
  const id = eng.callCheck({ actor: "pc.fighter", kind: "save", ability: "dex", dc: 10 });
  const gm = eng.store.timeline().find(e =>
    e.type === "check_resolved" && e.visibility === "gm" && (e.payload as any).checkId === id)!;
  assert.equal((gm.payload as any).outcome, "failure");
  assert.equal((gm.payload as any).roll, null);
  assert.equal(eng.state().pendingChecks[id], undefined);
});
