/** Gate: The Salt Mill (demo scene #2) + the fogged map wire. Dialogue
 *  rails answer in character with speaker tags, the ledger rail reveals to
 *  the party, the sluice rail reveals to the asker ALONE, the channel
 *  encounter springs real combatants into initiative, and the map payload
 *  never carries an unvisited name. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../../engine/src/engine.js";
import { PCS } from "../../../engine/src/srd.js";
import { SessionHub, type ClientConn } from "../src/hub.js";
import { EchoDM } from "../src/dm.js";
import { SCENES } from "../src/scenes.js";
import { MockMediaService } from "../src/media.js";

class FakeConn implements ClientConn {
  messages: any[] = [];
  send(msg: unknown): void { this.messages.push(msg); }
  ofType(t: string): any[] { return this.messages.filter(m => m.type === t); }
  last(t: string): any { return this.ofType(t).at(-1); }
  events(): any[] { return this.ofType("events").flatMap(m => m.events); }
}

function mill() {
  const engine = new Engine(7777);
  for (const pc of PCS) engine.join(pc.ref, pc);
  const hub = new SessionHub(engine, new EchoDM(SCENES.saltmill), new MockMediaService());
  const rogue = new FakeConn(), fighter = new FakeConn(), screen = new FakeConn();
  hub.join("r", rogue, { role: "box", characterId: "pc.rogue" });
  hub.join("f", fighter, { role: "box", characterId: "pc.fighter" });
  hub.join("s", screen, { role: "screen" });
  return { engine, hub, rogue, fighter, screen };
}

test("the mill opens on the village road and travels its rails", async () => {
  const t = mill();
  await t.hub.open();
  assert.equal(t.engine.state().scene?.locationId, "loc.village_road");
  await t.hub.handle("r", { type: "declare", text: "We walk up to the mill." });
  await t.hub.handle("r", { type: "declare", text: "I climb to the loft." });
  assert.deepEqual(t.engine.state().visitedLocations,
    ["loc.village_road", "loc.mill", "loc.loft"]);
});

test("Marta speaks with her voice tag; the ledger rail reveals to the party once", async () => {
  const t = mill();
  await t.hub.open();
  await t.hub.handle("r", { type: "declare", text: "We greet the old miller." });
  let marta = t.screen.events().filter(e => e.type === "narration_delivered").at(-1)!;
  assert.match((marta.payload as any).text, /^\[voice:npc\.marta\]/);
  await t.hub.handle("f", { type: "declare", text: "Show us the ledger, please." });
  const reveal = t.engine.store.timeline().filter(e => e.type === "fact_revealed"
    && (e.payload as any).factId === "fact.ledger_ghost_buyer");
  assert.equal(reveal.length, 1);
  assert.equal(reveal[0].visibility, "public"); // party-wide
  await t.hub.handle("r", { type: "declare", text: "What about the ledger again?" });
  assert.equal(t.engine.store.timeline().filter(e => e.type === "fact_revealed"
    && (e.payload as any).factId === "fact.ledger_ghost_buyer").length, 1, "re-revealed");
});

test("the sluice secret goes to the asker alone", async () => {
  const t = mill();
  await t.hub.open();
  await t.hub.handle("r", { type: "declare", text: "I follow the channel." });
  await t.hub.handle("r", { type: "declare", text: "Down to the sluice gate." });
  await t.hub.handle("r", { type: "declare", text: "I study the claw marks by the water." });
  const secret = t.engine.store.timeline().find(e => e.type === "fact_revealed"
    && (e.payload as any).factId === "secret.crawlers_fear_gate")!;
  assert.deepEqual(secret.visibility, ["pc.rogue"]);
  assert.ok(t.rogue.events().some(e => (e.payload as any)?.factId === "secret.crawlers_fear_gate"));
  assert.ok(!t.fighter.events().some(e => (e.payload as any)?.factId === "secret.crawlers_fear_gate"),
    "the secret leaked to another Box");
});

test("disturbing the channel springs two crawlers into initiative — once", async () => {
  const t = mill();
  await t.hub.open();
  await t.hub.handle("r", { type: "declare", text: "We cross to the channel bridge." });
  await t.hub.handle("r", { type: "declare", text: "I wade in and drag the water with a net." });
  const s = t.engine.state();
  assert.ok(s.combatants["demo.brine_crawler.1"]);
  assert.ok(s.combatants["demo.brine_crawler.2"]);
  assert.equal(s.order.length, 6); // 4 PCs + 2 crawlers
  assert.equal(s.round, 1);
  // the room saw steel drawn but never crawler numbers
  assert.ok(t.screen.events().some(e => e.type === "combat_started"));
  assert.ok(!JSON.stringify(t.screen.events()).includes('"maxHp":11'), "crawler numbers leaked");
  await t.hub.handle("f", { type: "declare", text: "I disturb the water again!" });
  assert.equal(Object.keys(t.engine.state().combatants).length, 6, "encounter re-spawned");
});

test("the fogged map wire: unvisited names never leave the server", async () => {
  const t = mill();
  await t.hub.open();
  await t.hub.handle("r", { type: "declare", text: "Into the mill." });
  const map = t.rogue.last("map");
  const known = map.nodes.filter((n: any) => n.known).map((n: any) => n.id).sort();
  assert.deepEqual(known, ["loc.mill", "loc.village_road"]);
  for (const n of map.nodes.filter((x: any) => !x.known))
    assert.equal(n.name, undefined, `frontier node ${n.id} carried its name`);
  // loft + channel are frontier stubs; the sluice (two hops away) is absent entirely
  const ids = map.nodes.map((n: any) => n.id);
  assert.ok(ids.includes("loc.loft") && ids.includes("loc.brine_channel"));
  assert.ok(!ids.includes("loc.sluice_gate"), "an unreachable node leaked");
});
