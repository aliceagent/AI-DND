/** THE campaign gate, public half (campaign-roadmap item 6): one full
 *  Salt Mill night — a character born in the interview walks all five
 *  locations, draws Marta out, learns the party secret and the private
 *  one, springs the ambush, wins the fight, and grows a level — with the
 *  fog complete at the end and the whole night replaying byte-faithfully. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../../engine/src/engine.js";
import { EventStore } from "../../../engine/src/store.js";
import { fold } from "../../../engine/src/state.js";
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

test("CAMPAIGN GATE: a full Salt Mill night, end to end", async () => {
  const engine = new Engine(20260612);
  const hub = new SessionHub(engine, new EchoDM(SCENES.saltmill), new MockMediaService());
  const phone = new FakeConn(), host = new FakeConn(), screen = new FakeConn();

  hub.join("screen", screen, { role: "screen" });
  await hub.open();

  // a soul is spoken into being
  hub.join("phone", phone, { role: "creator" });
  for (const input of [
    { text: "Call me Edda" }, { choice: "dwarf" }, { choice: "fighter" }, { choice: "soldier" },
    { abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 } },
    { choice: "str+2,con+1" }, { skills: ["perception", "survival"] },
    { text: "I guarded the salt pans at Whitecliff before the wars took the coast roads." },
    { confirm: true },
  ]) await hub.handle("phone", { type: "interview", input });
  hub.join("host", host, { role: "host" });

  // the mill walked end to end
  await hub.handle("phone", { type: "declare", text: "We walk up to the mill." });
  await hub.handle("phone", { type: "declare", text: "We greet the miller. Hello, Marta." });
  await hub.handle("phone", { type: "declare", text: "Show us the ledger." });
  await hub.handle("phone", { type: "declare", text: "I climb to the loft." });
  await hub.handle("phone", { type: "declare", text: "Down to the channel bridge." });
  await hub.handle("phone", { type: "declare", text: "Downstream to the sluice." });
  await hub.handle("phone", { type: "declare", text: "I study the claw marks by the water." });
  assert.equal(engine.state().visitedLocations.length, 5, "all five locations walked");

  // knowledge audit: party fact public, sluice secret Edda's alone
  assert.deepEqual(engine.state().facts["fact.ledger_ghost_buyer"], ["*"]);
  assert.deepEqual(engine.state().facts["secret.crawlers_fear_gate"], ["pc.edda"]);
  assert.ok(!JSON.stringify(screen.events()).includes("crawlers_fear_gate"),
    "the private secret reached the room");

  // the ambush springs; Edda finishes it with her engine-derived blade
  await hub.handle("phone", { type: "declare", text: "Back to the channel." });
  await hub.handle("phone", { type: "declare", text: "I wade in and drag the water." });
  assert.equal(engine.state().order.length, 3); // Edda + 2 crawlers
  const atk = (phone.events().find(e => e.type === "character_created")!.payload as any).attacks[0];
  engine.pcAttack("pc.edda", "demo.brine_crawler.1", atk, 18, [8]);
  engine.pcAttack("pc.edda", "demo.brine_crawler.2", atk, 17, [8]);
  hub.flushAll();
  assert.equal(engine.state().combatOver, true);
  assert.ok(phone.events().some(e => e.type === "combat_ended"), "victory reached the Box");

  // the host bestows growth
  await hub.handle("host", { type: "grant_levelup", characterId: "pc.edda" });
  await hub.handle("phone", { type: "levelup", choice: { method: "roll", reported: 8 } });
  const edda = engine.state().combatants["pc.edda"];
  assert.equal(edda.level, 2);
  assert.equal(edda.maxHp, 12 + 8 + 2); // d10 max + con, then 8 + con

  // the map is whole; the night replays
  const map = hub.mapPayload()!;
  assert.equal(map.nodes.filter((n: any) => n.known).length, 5);
  const replayed = fold(EventStore.fromJSONL(engine.store.toJSONL()).timeline());
  assert.deepEqual(replayed, engine.state());
  // and the standing audits hold to the end
  assert.ok(!JSON.stringify(phone.events()).includes('"dc"'), "a DC reached the phone");
  assert.ok(phone.events().every(e => e.visibility !== "gm"), "a gm event reached the phone");
});
