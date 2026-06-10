/** Canon-capture: Pip's inventions are ratified into the event log or
 *  flagged as corrections — and an invention that collides with the hidden
 *  layer is NEVER ratified. Recap: a filtered fold over visibleTo, so
 *  private reveals stay private and rewound branches vanish. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLlm, textReply } from "../src/llm.js";
import { newSession, playTurn } from "../src/session.js";
import { MOONLIT_CELLAR } from "../src/scene.js";
import { extractAssertions, reconcileAssertions, captureCanon } from "../src/canon.js";
import { recapLines, renderRecap } from "../src/recap.js";
import { toolCall } from "../src/llm.js";

test("inventions are ratified into the log; colliding ones become corrections", () => {
  const engine = newSession(20);
  const result = reconcileAssertions(engine, MOONLIT_CELLAR, [
    "a brass bell hangs by the stairs",                  // harmless invention → canon
    "a smuggler named Veska waits behind the false wall", // collides with the hidden layer
  ]);
  assert.deepEqual(result.ratified, ["a brass bell hangs by the stairs"]);
  assert.deepEqual(result.corrections, ["a smuggler named Veska waits behind the false wall"]);
  const ratified = engine.store.timeline().filter(e => e.type === "canon_ratified");
  assert.equal(ratified.length, 1);
  assert.equal((ratified[0].payload as any).assertion, "a brass bell hangs by the stairs");
  assert.equal(ratified[0].visibility, "public"); // canon is shared truth
});

test("extraction parses the model's JSON array, tolerating chatter around it", async () => {
  const llm = new MockLlm([textReply('Sure! ["a brass bell by the stairs"] hope that helps')]);
  const got = await extractAssertions(llm, "Above you a brass bell hangs by the stairs.", []);
  assert.deepEqual(got, ["a brass bell by the stairs"]);
  const llm2 = new MockLlm([textReply("no json here")]);
  assert.deepEqual(await extractAssertions(llm2, "x", []), []);
});

test("captureCanon end-to-end with a scripted extractor", async () => {
  const engine = newSession(21);
  const llm = new MockLlm([textReply('["the ledger-desk has a cracked leg"]')]);
  const result = await captureCanon(llm, engine, MOONLIT_CELLAR, "The ledger-desk leans on a cracked leg.");
  assert.deepEqual(result.ratified, ["the ledger-desk has a cracked leg"]);
  assert.ok(engine.store.timeline().some(e => e.type === "canon_ratified"));
});

test("recap is a filtered fold: private reveals stay private", () => {
  const engine = newSession(22);
  engine.revealFact("fact.cellar_dark", "party", "The cellar is dark.");
  engine.revealFact("fact.fresh_tracks", ["pc.rogue"], "Fresh tracks in the dust.");
  engine.ratifyCanon("a brass bell hangs by the stairs");

  const rogue = recapLines(engine.store, "pc.rogue");
  const fighter = recapLines(engine.store, "pc.fighter");
  assert.ok(rogue.some(l => l.includes("Fresh tracks")));
  assert.ok(!fighter.some(l => l.includes("Fresh tracks")), "private reveal leaked into another recap");
  for (const lines of [rogue, fighter, recapLines(engine.store, "party")]) {
    assert.ok(lines.some(l => l.includes("cellar is dark")));
    assert.ok(lines.some(l => l.includes("brass bell")));
  }
});

test("recap excludes rewound branches (the X-card erases the recap, not the log)", () => {
  const engine = newSession(23);
  engine.revealFact("fact.cellar_dark", "party", "The cellar is dark.");
  const cut = engine.store.timeline().at(-1)!.id;
  engine.revealFact("fact.crates", "party", "A body lies among the crates."); // the content to unsay
  engine.rewindTo(cut, "xcard-1");
  const lines = recapLines(engine.store, "party");
  assert.ok(lines.some(l => l.includes("cellar is dark")));
  assert.ok(!lines.some(l => l.includes("body")), "rewound content survived into the recap");
  assert.ok(engine.store.toJSONL().includes("body"), "raw log must retain the branch for audit");
});

test("playTurn records narration into the log and runs canon capture", async () => {
  const engine = newSession(24);
  const llm = new MockLlm([
    toolCall("send_narration_brief", { brief: {
      beat_id: "beat.cellar_search",
      scene_facts: [{ text: "The dark presses close.", fact_ref: null }],
      tone: { register: "dread" }, delivery: { max_sentences: 3 },
    } }),
    textReply("The dark presses close around your lantern."),  // Pip
    textReply('["the lantern is brass"]'),                      // canon extractor
  ]);
  const result = await playTurn(llm, engine, MOONLIT_CELLAR, { actor: "pc.rogue", text: "I step in." });
  assert.equal(result.narration, "The dark presses close around your lantern.");
  assert.ok(engine.store.timeline().some(e => e.type === "declaration"));
  assert.ok(engine.store.timeline().some(e => e.type === "narration_delivered"));
  assert.deepEqual(result.canon?.ratified, ["the lantern is brass"]);
  const recap = renderRecap(engine.store, "party");
  assert.ok(recap.includes("lantern is brass"));
});
