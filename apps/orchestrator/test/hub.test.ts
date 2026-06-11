/** Hub gates: the wire enforces invariant 2 (a Box receives exactly its
 *  visibleTo slice), the roll pad fires on check_called with the modifier
 *  pre-loaded, X-card rewinds anonymously to the turn checkpoint, and the
 *  floor queue switches modes with combat. EchoDM + MockMedia: no model,
 *  no sockets, fully deterministic. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../../engine/src/engine.js";
import { PCS } from "../../../engine/src/srd.js";
import { SessionHub, type ClientConn } from "../src/hub.js";
import { EchoDM } from "../src/dm.js";
import { MockMediaService } from "../src/media.js";

class FakeConn implements ClientConn {
  messages: any[] = [];
  send(msg: unknown): void { this.messages.push(msg); }
  ofType(t: string): any[] { return this.messages.filter(m => m.type === t); }
  events(): any[] { return this.ofType("events").flatMap(m => m.events); }
}

function table() {
  const engine = new Engine(99);
  for (const pc of PCS) engine.join(pc.ref, pc);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const conns = { rogueBox: new FakeConn(), fighterBox: new FakeConn(),
                  screen: new FakeConn(), host: new FakeConn() };
  hub.join("rogue", conns.rogueBox, { role: "box", characterId: "pc.rogue" });
  hub.join("fighter", conns.fighterBox, { role: "box", characterId: "pc.fighter" });
  hub.join("screen", conns.screen, { role: "screen" });
  hub.join("host", conns.host, { role: "host" });
  return { engine, hub, ...conns };
}

test("role-gated feeds: a Box gets exactly its visibleTo slice", async () => {
  const t = table();
  await t.hub.open();
  // a private reveal to the rogue, plus a secret engine check
  t.engine.revealFact("fact.fresh_tracks", ["pc.rogue"], "Fresh tracks in the dust.");
  t.engine.engineCheck({ actor: "pc.fighter", kind: "save", ability: "wis", dc: 11 });
  t.hub.flushAll();

  const rogueSees = t.rogueBox.events();
  const fighterSees = t.fighterBox.events();
  const screenSees = t.screen.events();
  assert.ok(rogueSees.some(e => e.type === "fact_revealed" && e.payload.factId === "fact.fresh_tracks"));
  assert.ok(!fighterSees.some(e => e.type === "fact_revealed" && e.payload?.factId === "fact.fresh_tracks"),
    "private reveal leaked to another Box");
  assert.ok(!screenSees.some(e => e.type === "fact_revealed" && e.payload?.factId === "fact.fresh_tracks"),
    "private reveal leaked to the shared screen");
  for (const view of [rogueSees, fighterSees, screenSees]) {
    assert.ok(!view.some(e => e.visibility === "gm"), "gm event left the server");
    assert.ok(!JSON.stringify(view).includes('"dc"'), "a DC reached a player feed");
  }
  // the host (gm seat) does see everything
  assert.ok(t.host.events().some(e => e.type === "check_resolved" && e.visibility === "gm"));
});

test("declaration → narration broadcast; mock stt carries the text through", async () => {
  const t = table();
  await t.hub.open();
  await t.hub.handle("rogue", { type: "ptt_start" });
  await t.hub.handle("rogue", { type: "ptt_end", text: "I creep down the stairs." });
  assert.ok(t.screen.ofType("narration").length >= 2, "screen missed narration");
  const decl = t.fighterBox.events().find(e => e.type === "declaration");
  assert.equal(decl.payload.text, "I creep down the stairs.");
});

test("roll pad: check_called routes a roll_request with the modifier pre-loaded", async () => {
  const t = table();
  await t.hub.open();
  await t.hub.handle("rogue", { type: "declare", text: "I search the desk for hidden drawers." });

  const req = t.rogueBox.ofType("roll_request")[0];
  assert.ok(req, "roll pad never fired");
  assert.equal(req.skill, "investigation");
  assert.equal(req.modifier, 1); // Vex: int +1, not proficient in investigation
  assert.equal(t.fighterBox.ofType("roll_request").length, 0, "roll pad fired on the wrong Box");

  await t.hub.handle("rogue", { type: "roll", checkId: req.checkId, rolls: [15] });
  assert.equal(Object.keys(t.engine.state().pendingChecks).length, 0);
  const outcomes = t.screen.events().filter(e => e.type === "check_resolved");
  assert.ok(outcomes.length === 1 && !("dc" in outcomes[0].payload));
});

test("another player cannot answer someone else's roll", async () => {
  const t = table();
  await t.hub.open();
  await t.hub.handle("rogue", { type: "declare", text: "I look around the room." });
  const req = t.rogueBox.ofType("roll_request")[0];
  await assert.rejects(t.hub.handle("fighter", { type: "roll", checkId: req.checkId, rolls: [20] }),
    /no pending check/);
});

test("x-card: anonymous, rewinds the turn, feeds reset past the cut", async () => {
  const t = table();
  await t.hub.open();
  await t.hub.handle("rogue", { type: "declare", text: "Something terrible happens here." });
  assert.ok(t.fighterBox.events().some(e => e.payload?.text?.includes("terrible")));

  await t.hub.handle("fighter", { type: "xcard" });
  const note = t.screen.ofType("xcard_rewound")[0];
  assert.ok(note, "x-card not announced");
  assert.equal(Object.keys(note).length, 1, "x-card message must carry no attribution");
  const trunc = t.screen.ofType("truncate")[0];
  assert.ok(trunc && typeof trunc.after === "number", "clients need the cut point to drop stale events");
  assert.ok(t.engine.store.activeBranch().startsWith("xcard-"));
  // the rewound content is off the timeline (recaps clean) but in the raw log (audit)
  assert.ok(!t.engine.store.timeline().some(e => (e.payload as any)?.text?.includes("terrible")));
  assert.ok(t.engine.store.toJSONL().includes("terrible"));
});

test("floor queue: press order in exploration, initiative owns it in combat", async () => {
  const t = table();
  await t.hub.open();
  await t.hub.handle("fighter", { type: "ptt_start" });
  await t.hub.handle("rogue", { type: "ptt_start" });
  let floor = t.screen.ofType("floor").at(-1);
  assert.equal(floor.mode, "exploration");
  assert.deepEqual(floor.queue, ["pc.fighter", "pc.rogue"]);

  t.engine.rollInitiativeAll({});
  await t.hub.handle("fighter", { type: "ptt_start" }); // re-broadcast under combat
  floor = t.screen.ofType("floor").at(-1);
  assert.equal(floor.mode, "combat");
  assert.equal(floor.queue[0], t.engine.state().order[0], "active combatant must head the floor");
});

test("a late joiner catches up: full visible history on join", async () => {
  const t = table();
  await t.hub.open();
  await t.hub.handle("rogue", { type: "declare", text: "I light a second lantern." });
  const late = new FakeConn();
  t.hub.join("late", late, { role: "box", characterId: "pc.cleric" });
  assert.ok(late.events().some(e => e.type === "narration_delivered"));
  assert.ok(late.events().some(e => e.payload?.text === "I light a second lantern."));
});

test("role guards: a screen cannot declare, only the host can hard-rewind", async () => {
  const t = table();
  await t.hub.open();
  await assert.rejects(t.hub.handle("screen", { type: "declare", text: "hi" }), /box role required/);
  await assert.rejects(t.hub.handle("rogue", { type: "rewind", eventId: 1 }), /host role required/);
});

test("scene plumbing: the DM opens with a scene; travel declarations move it", async () => {
  const t = table();
  await t.hub.open();
  let scenes = t.screen.events().filter(e => e.type === "scene_set");
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].payload.location_id, "loc.cellar");
  assert.equal(scenes[0].payload.mood, "dread");

  await t.hub.handle("rogue", { type: "declare", text: "We head upstairs to the counting-house." });
  scenes = t.screen.events().filter(e => e.type === "scene_set");
  assert.equal(scenes.length, 2);
  assert.equal(scenes[1].payload.location_id, "loc.counting_house");
  assert.equal(t.engine.state().visitedLocations.length, 2);
});

test("host combat controls: start_combat rolls initiative, advance_turn moves it; boxes cannot", async () => {
  const t = table();
  await t.hub.open();
  await assert.rejects(t.hub.handle("rogue", { type: "start_combat" }), /host role required/);
  await t.hub.handle("host", { type: "start_combat" });
  const s = t.engine.state();
  assert.equal(s.order.length, 4);
  assert.equal(s.round, 1);
  assert.ok(t.screen.events().some(e => e.type === "combat_started"), "the room saw initiative");
  const before = t.engine.state().turnIndex;
  await t.hub.handle("host", { type: "advance_turn" });
  assert.ok(t.screen.events().some(e => e.type === "turn_advanced"));
  assert.notEqual(t.engine.state().turnIndex, before);
});
