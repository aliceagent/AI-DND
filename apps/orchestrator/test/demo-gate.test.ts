/** THE Mac demo gate (docs/mac-roadmap.md item 6, charcreate-box-plan §E):
 *  a phone creates a character end-to-end in mock mode — typed "voice",
 *  chips, backstory, portrait prompt persisted — then plays: a check is
 *  called, the roll pad answers it, initiative runs, and the character
 *  fights a kobold; the engine validated every step, the Box's feed never
 *  saw a DC or a gm event, and the whole night replays byte-faithfully. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../../engine/src/engine.js";
import { EventStore } from "../../../engine/src/store.js";
import { fold } from "../../../engine/src/state.js";
import { KOBOLD } from "../../../engine/src/srd.js";
import { SessionHub, type ClientConn } from "../src/hub.js";
import { EchoDM } from "../src/dm.js";
import { MockMediaService } from "../src/media.js";

class FakeConn implements ClientConn {
  messages: any[] = [];
  send(msg: unknown): void { this.messages.push(msg); }
  ofType(t: string): any[] { return this.messages.filter(m => m.type === t); }
  last(t: string): any { return this.ofType(t).at(-1); }
  events(): any[] { return this.ofType("events").flatMap(m => m.events); }
}

test("DEMO GATE: voice-create in mock mode, then fight a kobold", async () => {
  const engine = new Engine(20260611);
  const hub = new SessionHub(engine, new EchoDM(), new MockMediaService());
  const phone = new FakeConn();
  const screen = new FakeConn();

  // ----- the screen is on the wall; the scene opens
  hub.join("screen", screen, { role: "screen" });
  await hub.open();
  assert.ok(screen.ofType("narration").length >= 1, "the room heard Pip");

  // ----- a player picks up a phone and speaks a character into being
  hub.join("phone", phone, { role: "creator" });
  for (const input of [
    { text: "Call me Sera" }, { text: "halfling, please" }, { choice: "rogue" },
    { choice: "criminal" },
    { abilities: { str: 10, dex: 15, con: 13, int: 12, wis: 14, cha: 8 } },
    { choice: "dex+2,con+1" },
    { skills: ["acrobatics", "deception", "perception", "insight"] },
    { text: "I cut purses on the Coast Way until I lifted the wrong ledger and had to vanish." },
    { confirm: true },
  ]) await hub.handle("phone", { type: "interview", input });

  assert.equal(phone.last("joined").role, "box");
  const sera = engine.state().combatants["pc.sera"];
  assert.equal(sera.maxHp, 10);                       // d8 + con 2, engine-derived
  assert.ok(sera.portrait!.startsWith("pending:"), "portrait prompt persisted");
  assert.ok(screen.events().some(e => e.type === "portrait_attached"),
    "the table saw the reveal");

  // ----- she investigates; the roll pad answers
  await hub.handle("phone", { type: "declare", text: "I search the crates for anything hidden." });
  const req = phone.last("roll_request");
  assert.equal(req.skill, "investigation");
  assert.equal(req.modifier, 1);                      // int +1, untrained — derived, not stored
  await hub.handle("phone", { type: "roll", checkId: req.checkId, rolls: [13] });
  assert.ok(screen.events().some(e =>
    e.type === "check_resolved" && e.payload.outcome === "success")); // 13+1 ≥ 12

  // ----- steel: a kobold, initiative, the fight
  engine.join("kobold.1", { ...KOBOLD, name: "Kobold" });
  engine.rollInitiativeAll();
  await hub.handle("phone", { type: "ptt_start" });   // combat floor: initiative owns it
  assert.equal(screen.last("floor").mode, "combat");

  const atk = (phone.events().find(e => e.type === "character_created")!.payload as any)
    .attacks[0]; // shortsword +5, 1d6+3 — derived by the engine, read from her own event
  engine.pcAttack("pc.sera", "kobold.1", atk, 18, [4]);
  hub.flushAll();
  assert.ok(engine.state().combatants["kobold.1"].conditions.includes("dead"));
  assert.ok(phone.events().some(e => e.type === "combat_ended"), "victory reached the Box");

  // ----- the audit: her feed never carried a DC or a gm event
  const feed = phone.events();
  assert.ok(!JSON.stringify(feed).includes('"dc"'), "a DC reached the phone");
  assert.ok(feed.every(e => e.visibility !== "gm"), "a gm event reached the phone");
  // …and her private record stayed hers alone
  assert.ok(!screen.events().some(e => e.type === "backstory_recorded"),
    "the backstory leaked to the room");

  // ----- the whole night replays
  const replayed = fold(EventStore.fromJSONL(engine.store.toJSONL()).timeline());
  assert.deepEqual(replayed, engine.state());
});
