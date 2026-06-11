/** Gate: the campaign pack loader + Beat Navigator. The loader rejects
 *  broken packs with named errors; running a beat sets the scene and
 *  springs its encounter exactly once; the beats list and gm panels reach
 *  the HOST seat alone — boxes and the screen never see a byte of gm data. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../../engine/src/engine.js";
import { PCS } from "../../../engine/src/srd.js";
import { SessionHub, type ClientConn } from "../src/hub.js";
import { validateCampaign, runBeat, CampaignDM, type Campaign } from "../src/campaign.js";
import { MockMediaService } from "../src/media.js";

class FakeConn implements ClientConn {
  messages: any[] = [];
  send(msg: unknown): void { this.messages.push(msg); }
  ofType(t: string): any[] { return this.messages.filter(m => m.type === t); }
  last(t: string): any { return this.ofType(t).at(-1); }
  events(): any[] { return this.ofType("events").flatMap(m => m.events); }
}

/** Tiny original two-beat fixture pack. */
const PACK: Campaign = {
  id: "demo.fixture", title: "The Fixture Run",
  locations: {
    "loc.gatehouse": { id: "loc.gatehouse", name: "The Gatehouse", mood: "tense",
      palette: "lamp-gold", x: 40, y: 60 },
    "loc.undercroft": { id: "loc.undercroft", name: "The Undercroft", mood: "dread",
      palette: "cave-dark", x: 140, y: 90 },
  },
  edges: [["loc.gatehouse", "loc.undercroft"]],
  beats: [
    { id: "b1", title: "At the Gate", location: "loc.gatehouse", encounter: null,
      gm: { summary: "The wardens are short-handed and frightened.",
        hints: ["A guard keeps glancing at the undercroft stair."],
        constraints: ["Never name what is below."],
        secrets: ["secret.below_thing"] } },
    { id: "b2", title: "The Undercroft", location: "loc.undercroft",
      encounter: { groups: [{ stat_ref: "srd.kobold", count: 3 }] },
      gm: { summary: "Three burrowers defend the breach." } },
  ],
  statblocks: {},
};

test("the loader rejects broken packs with named errors", () => {
  const t = (mut: (c: any) => void, re: RegExp) => {
    const c = structuredClone(PACK); mut(c);
    assert.throws(() => validateCampaign(c), re);
  };
  t(c => delete c.locations["loc.undercroft"], /references missing location|unknown location/);
  t(c => (c.beats[1].encounter.groups[0].stat_ref = "pack.unknown"), /unresolved stat_ref/);
  t(c => (c.beats = []), /no beats/);
  t(c => delete c.locations["loc.gatehouse"].palette, /missing palette/);
  validateCampaign(structuredClone(PACK)); // the fixture itself is sound
});

test("running a beat: scene + encounter once, initiative rolls", () => {
  const engine = new Engine(91);
  for (const pc of PCS) engine.join(pc.ref, pc);
  runBeat(engine, PACK, "b1");
  assert.equal(engine.state().scene?.locationId, "loc.gatehouse");
  assert.equal(engine.state().order.length, 0); // no encounter at the gate
  runBeat(engine, PACK, "b2");
  const s = engine.state();
  assert.equal(s.scene?.locationId, "loc.undercroft");
  assert.equal(Object.keys(s.combatants).length, 7); // 4 PCs + 3 kobolds
  assert.equal(s.round, 1);
  runBeat(engine, PACK, "b2"); // re-running never respawns
  assert.equal(Object.keys(engine.state().combatants).length, 7);
  assert.throws(() => runBeat(engine, PACK, "b9"), /unknown beat/);
});

test("the Navigator and gm panels reach the host alone", async () => {
  const engine = new Engine(92);
  for (const pc of PCS) engine.join(pc.ref, pc);
  const hub = new SessionHub(engine, new CampaignDM(PACK), new MockMediaService(),
    undefined, null, PACK);
  const host = new FakeConn(), box = new FakeConn(), screen = new FakeConn();
  hub.join("b", box, { role: "box", characterId: "pc.rogue" });
  hub.join("s", screen, { role: "screen" });
  hub.join("h", host, { role: "host" });

  const list = host.last("beats");
  assert.equal(list.campaign, "The Fixture Run");
  assert.equal(list.beats.length, 2);
  assert.equal(list.beats[0].gm.summary, "The wardens are short-handed and frightened.");
  assert.equal(box.ofType("beats").length, 0, "beats reached a box");
  assert.equal(screen.ofType("beats").length, 0, "beats reached the screen");

  await assert.rejects(hub.handle("b", { type: "run_beat", beatId: "b1" }), /host role/);
  await hub.handle("h", { type: "run_beat", beatId: "b1" });
  assert.equal(host.last("beat_running").gm.constraints[0], "Never name what is below.");
  // the room got the scene; nobody but the host got gm words
  assert.ok(screen.events().some(e => e.type === "scene_set"
    && e.payload.location_id === "loc.gatehouse"));
  for (const conn of [box, screen]) {
    const all = JSON.stringify(conn.messages);
    assert.ok(!all.includes("secret.below_thing"), "a gm secret left the host seat");
    assert.ok(!all.includes("Never name"), "a gm constraint left the host seat");
  }

  await hub.handle("h", { type: "run_beat", beatId: "b2" });
  assert.ok(screen.events().some(e => e.type === "combat_started"));
  // fogged map: the undercroft became known on arrival
  const map = box.last("map");
  assert.ok(map.nodes.find((n: any) => n.id === "loc.undercroft")?.known);
});

test("the campaign DM keeps checks flowing and otherwise yields the floor", async () => {
  const engine = new Engine(93);
  for (const pc of PCS) engine.join(pc.ref, pc);
  const hub = new SessionHub(engine, new CampaignDM(PACK), new MockMediaService(),
    undefined, null, PACK);
  const box = new FakeConn(), screen = new FakeConn();
  hub.join("b", box, { role: "box", characterId: "pc.rogue" });
  hub.join("s", screen, { role: "screen" });
  await hub.open();
  const baseline = screen.ofType("narration").length;
  await hub.handle("b", { type: "declare", text: "I search the gate for weak hinges." });
  assert.ok(box.last("roll_request"), "checks must still flow in host mode");
  await hub.handle("b", { type: "declare", text: "We argue about lunch." });
  // silence: no new narration for table talk — the human host speaks
  assert.equal(screen.ofType("narration").length, baseline + 1); // only the check call
});
