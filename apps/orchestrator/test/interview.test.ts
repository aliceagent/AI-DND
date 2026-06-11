/** Gate: the creation interview. A scripted transcript (voice-text and
 *  chips mixed) yields a legal character_created through the hub; bad
 *  inputs keep the step with a usable error; the connection rebinds as the
 *  character's Box; duplicate names get fresh ids. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../../engine/src/engine.js";
import { SessionHub, type ClientConn } from "../src/hub.js";
import { InterviewSession } from "../src/interview.js";
import { EchoDM } from "../src/dm.js";
import { MockMediaService } from "../src/media.js";

class FakeConn implements ClientConn {
  messages: any[] = [];
  send(msg: unknown): void { this.messages.push(msg); }
  ofType(t: string): any[] { return this.messages.filter(m => m.type === t); }
  last(t: string): any { return this.ofType(t).at(-1); }
}

const ABILITIES = { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 };

function runInterview(s: InterviewSession) {
  s.handle({ text: "Call me Brena" });
  s.handle({ text: "I'm a dwarf" });               // voice path through the parser
  s.handle({ choice: "fighter" });                  // chip path
  s.handle({ choice: "soldier" });
  s.handle({ abilities: ABILITIES });
  s.handle({ choice: "str+2,con+1" });
  s.handle({ skills: ["perception", "survival"] });
  s.handle({ text: "I held the bridge at Marlow ford until the carts were across." });
  return s.handle({ confirm: true });
}

test("a mixed voice/chip transcript builds a legal character", () => {
  const s = new InterviewSession();
  const end = runInterview(s);
  assert.equal(end.step, "done");
  assert.equal(s.build.id, "pc.brena");
  assert.equal(s.build.species, "dwarf");
  assert.equal(end.preview?.maxHp, 12);
  assert.equal(end.preview?.ac, 16);
});

test("bad inputs keep the step and explain; the machine never advances illegally", () => {
  const s = new InterviewSession();
  s.handle({ text: "Brena" });
  let st = s.handle({ text: "I am a dragon, obviously" });   // not a species
  assert.equal(st.step, "species");
  assert.ok(st.error);
  s.handle({ choice: "dwarf" });
  s.handle({ choice: "fighter" });
  s.handle({ choice: "soldier" });
  st = s.handle({ abilities: { ...ABILITIES, str: 18 } });   // not the array
  assert.equal(st.step, "abilities");
  assert.match(st.error!, /standard array/);
  s.handle({ abilities: ABILITIES });
  st = s.handle({ choice: "wis+2,con+1" });                  // wis isn't soldier's
  assert.equal(st.step, "bonus");
  s.handle({ choice: "str+2,con+1" });
  st = s.handle({ skills: ["perception"] });                 // wrong count
  assert.match(st.error!, /exactly 2/);
  st = s.handle({ skills: ["athletics", "perception"] });    // background overlap →
  s.handle({ text: "A long story about bridges and fords." });
  st = s.handle({ confirm: true });                          // …caught at the authority
  assert.notEqual(st.step, "done");
  assert.match(st.error ?? "", /already proficient/);
});

test("ambiguous voice answers ask again instead of guessing", () => {
  const s = new InterviewSession();
  s.handle({ text: "Brena" });
  const st = s.handle({ text: "elf or dwarf, surprise me" }); // matches two chips
  assert.equal(st.step, "species");
  assert.ok(st.error);
});

test("duplicate names get fresh ids", () => {
  const taken = new Set(["pc.brena"]);
  const s = new InterviewSession(id => taken.has(id));
  s.handle({ text: "Brena" });
  assert.equal(s.state.draft.id, "pc.brena_2");
});

test("hub: creator joins, finishes, rebinds as the character's Box", async () => {
  const engine = new Engine(77);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const phone = new FakeConn();
  hub.join("p1", phone, { role: "creator" });
  assert.equal(phone.last("joined").role, "creator");
  assert.equal(phone.last("interview_state").step, "name");

  for (const input of [
    { text: "Call me Brena" }, { choice: "dwarf" }, { choice: "fighter" },
    { choice: "soldier" }, { abilities: ABILITIES }, { choice: "str+2,con+1" },
    { skills: ["perception", "survival"] },
    { text: "I held the bridge at Marlow ford until the carts were across." },
    { confirm: true },
  ]) await hub.handle("p1", { type: "interview", input });

  assert.equal(phone.last("character_sealed").characterId, "pc.brena");
  assert.equal(phone.last("joined").role, "box");
  // the new Box received its own private record — sheet and backstory
  const events = phone.ofType("events").flatMap(m => m.events);
  assert.ok(events.some(e => e.type === "character_created"));
  assert.ok(events.some(e => e.type === "backstory_recorded"));
  // the engine has the combatant; the table can fight
  assert.equal(engine.state().combatants["pc.brena"].maxHp, 12);
  // a second device can rebind to the same character later
  const phone2 = new FakeConn();
  hub.join("p2", phone2, { role: "box", characterId: "pc.brena" });
  assert.ok(phone2.ofType("events").flatMap(m => m.events)
    .some(e => e.type === "character_created"));
  // …but a box join to a nonexistent character is refused
  assert.throws(() => hub.join("p3", new FakeConn(), { role: "box", characterId: "pc.ghost" }),
    /unknown character/);
});

test("hub: non-creators cannot drive an interview", async () => {
  const engine = new Engine(78);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const screen = new FakeConn();
  hub.join("s1", screen, { role: "screen" });
  await assert.rejects(hub.handle("s1", { type: "interview", input: { text: "hi" } }),
    /creator role required/);
});

test("hub: Box tab commands — cast spends a slot, refusals surface, items consume", async () => {
  const engine = new Engine(79);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const phone = new FakeConn();
  hub.join("p1", phone, { role: "creator" });
  for (const input of [
    { text: "Mara" }, { choice: "human" }, { choice: "cleric" }, { choice: "acolyte" },
    { abilities: { str: 12, dex: 10, con: 13, int: 8, wis: 15, cha: 14 } },
    { choice: "wis+2,cha+1" }, { skills: ["medicine", "history"] },
    { text: "I swept the shrine steps for twelve years and listened." },
    { confirm: true },
  ]) await hub.handle("p1", { type: "interview", input });

  engine.grantItem("pc.mara", { id: "potion", name: "Potion of Healing" });
  await hub.handle("p1", { type: "cast", level: 1 });
  await hub.handle("p1", { type: "cast", level: 1 });
  assert.deepEqual(engine.state().combatants["pc.mara"].slots["1"], { max: 2, used: 2 });
  await hub.handle("p1", { type: "cast", level: 1 }); // dry — engine refuses, client told
  assert.match(phone.last("error").error, /no level-1 slot/);
  await hub.handle("p1", { type: "use_item", itemId: "potion" });
  assert.equal(engine.state().combatants["pc.mara"].inventory.length, 0);
  await hub.handle("p1", { type: "use_item", itemId: "potion" });
  assert.match(phone.last("error").error, /does not carry/);
});

test("portrait pipeline: sealed characters get a public portrait with the prompt persisted", async () => {
  const engine = new Engine(80);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const phone = new FakeConn();
  hub.join("p1", phone, { role: "creator" });
  for (const input of [
    { text: "Brena" }, { choice: "dwarf" }, { choice: "fighter" }, { choice: "soldier" },
    { abilities: ABILITIES }, { choice: "str+2,con+1" }, { skills: ["perception", "survival"] },
    { text: "I held the bridge at Marlow ford until the carts were across." },
    { confirm: true },
  ]) await hub.handle("p1", { type: "interview", input });

  const port = engine.store.timeline().filter(e => e.type === "portrait_attached");
  assert.equal(port.length, 1);
  assert.equal(port[0].visibility, "public");              // the table sees faces
  const p = port[0].payload as any;
  assert.match(p.prompt, /dwarf/);                          // species in the block
  assert.match(p.prompt, /16:9/);                           // widescreen baked in
  assert.match(p.prompt, /campaign|cinematic|painterly/i);  // campaign style block
  assert.match(p.prompt, /campaign-worn|bridge|mended/i);   // a visible mark from the story
  assert.match(p.asset, /^pending:\d+/);                    // mock: prompt now, pixels later
  assert.equal(engine.state().combatants["pc.brena"].portrait, p.asset);

  // one free re-roll produces a new take; the second is refused
  await hub.handle("p1", { type: "portrait_reroll" });
  assert.equal(engine.store.timeline().filter(e => e.type === "portrait_attached").length, 2);
  await hub.handle("p1", { type: "portrait_reroll" });
  assert.match(phone.last("error").error, /re-roll spent/);
  const takes = engine.store.timeline().filter(e => e.type === "portrait_attached")
    .map(e => (e.payload as any).asset);
  assert.notEqual(takes[0], takes[1]); // different deterministic seeds
});

test("phase-4 extras: pace votes reach the host; approvals gate the portrait re-roll", async () => {
  const engine = new Engine(81);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const phone = new FakeConn();
  const host = new FakeConn();
  hub.join("p1", phone, { role: "creator" });
  for (const input of [
    { text: "Brena" }, { choice: "dwarf" }, { choice: "fighter" }, { choice: "soldier" },
    { abilities: ABILITIES }, { choice: "str+2,con+1" }, { skills: ["perception", "survival"] },
    { text: "I held the bridge at Marlow ford until the carts were across." },
    { confirm: true },
  ]) await hub.handle("p1", { type: "interview", input });

  // a late host sees the pending approvals immediately
  hub.join("h1", host, { role: "host" });
  const q = host.last("approvals").queue;
  assert.deepEqual(q.map((a: any) => a.kind).sort(), ["character", "portrait"]);

  // pace: the box taps ▲▲▼ — only the host hears the table's pulse
  await hub.handle("p1", { type: "pace", dir: "up" });
  await hub.handle("p1", { type: "pace", dir: "up" });
  await hub.handle("p1", { type: "pace", dir: "down" });
  assert.deepEqual(host.last("table_state").pace.up, 2);
  assert.deepEqual(host.last("table_state").pace.down, 1);
  assert.equal(phone.ofType("table_state").length, 0, "telemetry leaked to a box");

  // approvals: character yes; portrait no → the re-roll re-opens
  await hub.handle("p1", { type: "portrait_reroll" });            // burn the free one
  await hub.handle("p1", { type: "portrait_reroll" });
  assert.match(phone.last("error").error, /re-roll spent/);
  await hub.handle("h1", { type: "approve", characterId: "pc.brena", kind: "character", ok: true });
  await hub.handle("h1", { type: "approve", characterId: "pc.brena", kind: "portrait", ok: false });
  assert.match(phone.last("host_note").text, /another face/);
  await hub.handle("p1", { type: "portrait_reroll" });            // open again
  assert.equal(engine.store.timeline().filter(e => e.type === "portrait_attached").length, 3);
  // non-hosts cannot judge
  await assert.rejects(hub.handle("p1", { type: "approve", characterId: "pc.brena", kind: "portrait", ok: true }),
    /host role required/);
});

test("table-state vector: telemetry aggregates, spotlight debt finds the quiet player", async () => {
  const engine = new Engine(82);
  // two pre-made characters so two boxes can join directly
  const { PCS } = await import("../../../engine/src/srd.js");
  for (const pc of PCS) engine.join(pc.ref, pc);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const rogue = new FakeConn(), fighter = new FakeConn(), host = new FakeConn();
  hub.join("r", rogue, { role: "box", characterId: "pc.rogue" });
  hub.join("f", fighter, { role: "box", characterId: "pc.fighter" });
  hub.join("h", host, { role: "host" });

  await hub.handle("r", { type: "ptt_start" });
  await hub.handle("r", { type: "ptt_end", text: "I scout ahead quietly." });
  await hub.handle("r", { type: "activity", kind: "tab" });
  await hub.handle("f", { type: "activity", kind: "tab" });
  await hub.handle("r", { type: "declare", text: "And I check the door." });

  const ts = host.last("table_state");
  const r = ts.players.find((p: any) => p.characterId === "pc.rogue");
  const f = ts.players.find((p: any) => p.characterId === "pc.fighter");
  assert.equal(r.ptt, 1);
  assert.equal(r.declarations, 2);   // ptt_end + declare
  assert.equal(r.taps, 1);
  assert.equal(f.declarations, 0);
  // the fighter has been quiet longest → top of the spotlight queue
  assert.equal(ts.spotlightDebt[0], "pc.fighter");
  // telemetry stays host-side
  assert.equal(rogue.ofType("table_state").length, 0);
});

test("level-up flow: host grants, the Box chooses, the engine validates, the room hears", async () => {
  const engine = new Engine(83);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const phone = new FakeConn(), host = new FakeConn(), screen = new FakeConn();
  hub.join("p1", phone, { role: "creator" });
  hub.join("s1", screen, { role: "screen" });
  for (const input of [
    { text: "Brena" }, { choice: "dwarf" }, { choice: "fighter" }, { choice: "soldier" },
    { abilities: ABILITIES }, { choice: "str+2,con+1" }, { skills: ["perception", "survival"] },
    { text: "I held the bridge at Marlow ford until the carts were across." },
    { confirm: true },
  ]) await hub.handle("p1", { type: "interview", input });
  hub.join("h1", host, { role: "host" });

  // boxes can't grant; an unoffered level-up is refused
  await assert.rejects(hub.handle("p1", { type: "grant_levelup", characterId: "pc.brena" }), /host role/);
  await hub.handle("p1", { type: "levelup", choice: { method: "average" } });
  assert.match(phone.last("error").error, /no level-up offered/);

  // the grant lands on the right box with the right die
  await hub.handle("h1", { type: "grant_levelup", characterId: "pc.brena" });
  const offer = phone.last("levelup_offer");
  assert.equal(offer.toLevel, 2);
  assert.equal(offer.hitDie, 10);
  assert.equal(screen.ofType("levelup_offer").length, 0, "offer leaked to the room");

  // a bad roll is refused but the offer survives; a good one lands
  await hub.handle("p1", { type: "levelup", choice: { method: "roll", reported: 99 } });
  assert.match(phone.last("error").error, /outside 1-10/);
  await hub.handle("p1", { type: "levelup", choice: { method: "roll", reported: 7 } });
  const c = engine.state().combatants["pc.brena"];
  assert.equal(c.level, 2);
  assert.equal(c.maxHp, 12 + 7 + 2); // d10 max + con2, then 7 + con2
  assert.equal(screen.last("hero_grows").characterId, "pc.brena"); // the room celebrates
  // the offer is spent
  await hub.handle("p1", { type: "levelup", choice: { method: "average" } });
  assert.match(phone.last("error").error, /no level-up offered/);
});
