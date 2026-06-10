/** THE Phase 2 gate: the context assembler is the safety boundary.
 *  A gm-scoped fact id appearing in a brief is a hard rejection — asserted
 *  here. DCs are structurally absent. The Narrator context contains nothing
 *  but the validated brief and the revealed transcript. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newSession } from "../src/session.js";
import { MOONLIT_CELLAR } from "../src/scene.js";
import { validateBrief, BriefRejection, assembleNarratorContext, revealedTranscript,
         partyRevealedFactIds } from "../src/context.js";

const goodBrief = () => ({
  beat_id: "beat.cellar_search",
  scene_facts: [
    { text: "The cellar is dark and smells of mildew.", fact_ref: "fact.cellar_dark", emphasis: "lead" },
  ],
  sanctioned_hints: ["The dust has been disturbed more recently than the ledgers suggest."],
  negative_constraints: ["do not describe the back wall in any detail"],
  tone: { register: "dread", tension: 4 },
  delivery: { max_sentences: 5 },
});

function sessionWithReveals() {
  const engine = newSession(1);
  engine.revealFact("fact.cellar_dark", "party", "The cellar is dark.");
  engine.revealFact("fact.crates", "party", "Rotting crates line the walls.");
  return engine;
}

test("a clean brief validates", () => {
  const engine = sessionWithReveals();
  const brief = validateBrief(goodBrief(), MOONLIT_CELLAR, engine);
  assert.equal(brief.beat_id, "beat.cellar_search");
});

test("GATE: a gm-scoped fact id anywhere in the brief is a hard rejection", () => {
  const engine = sessionWithReveals();
  // in a fact_ref
  assert.throws(() => validateBrief({ ...goodBrief(),
    scene_facts: [{ text: "x", fact_ref: "secret.veska_thorn" }] },
    MOONLIT_CELLAR, engine), BriefRejection);
  // buried in a sanctioned hint
  assert.throws(() => validateBrief({ ...goodBrief(),
    sanctioned_hints: ["as foretold by secret.false_wall, the wall waits"] },
    MOONLIT_CELLAR, engine), BriefRejection);
  // even inside a negative constraint (the Narrator must not see the id at all)
  assert.throws(() => validateBrief({ ...goodBrief(),
    negative_constraints: ["never mention secret.dawn_buyer"] },
    MOONLIT_CELLAR, engine), BriefRejection);
  // and the rejection names the offender
  try {
    validateBrief({ ...goodBrief(), sanctioned_hints: ["secret.veska_thorn"] }, MOONLIT_CELLAR, engine);
    assert.fail("should have rejected");
  } catch (e) {
    assert.ok(e instanceof BriefRejection);
    assert.ok(e.reasons.some(r => r.includes("secret.veska_thorn")));
  }
});

test("GATE: a dc key at any depth is a hard rejection (DCs are structurally absent)", () => {
  const engine = sessionWithReveals();
  const b: any = goodBrief();
  b.delivery.end_with = "check_call";
  b.delivery.check_call = { actor: "pc.rogue", kind: "check", ability: "dex", skill: "stealth", dc: 15 };
  assert.throws(() => validateBrief(b, MOONLIT_CELLAR, engine), BriefRejection);
  const b2: any = goodBrief();
  b2.av_cues = { sfx: [], image_request: null, music_mood: null, music_escalation_step: null };
  (b2.av_cues as any).dc = 12;
  assert.throws(() => validateBrief(b2, MOONLIT_CELLAR, engine), BriefRejection);
});

test("a fact_ref not revealed to the party is rejected — even a party-scoped one", () => {
  const engine = sessionWithReveals(); // fact.fresh_tracks exists but is unrevealed
  assert.throws(() => validateBrief({ ...goodBrief(),
    scene_facts: [{ text: "tracks", fact_ref: "fact.fresh_tracks" }] },
    MOONLIT_CELLAR, engine), BriefRejection);
  // a reveal to a single character is Box-private, still not narration-safe
  engine.revealFact("fact.fresh_tracks", ["pc.rogue"], "tracks");
  assert.throws(() => validateBrief({ ...goodBrief(),
    scene_facts: [{ text: "tracks", fact_ref: "fact.fresh_tracks" }] },
    MOONLIT_CELLAR, engine), BriefRejection);
  // a party reveal makes it narratable
  engine.revealFact("fact.fresh_tracks", "party", "tracks");
  validateBrief({ ...goodBrief(),
    scene_facts: [{ text: "tracks", fact_ref: "fact.fresh_tracks" }] },
    MOONLIT_CELLAR, engine);
});

test("a legitimately revealed secret becomes narratable (the game can still be played)", () => {
  const engine = sessionWithReveals();
  engine.revealFact("secret.false_wall", "party", "The back wall is false!");
  const brief = validateBrief({ ...goodBrief(),
    scene_facts: [{ text: "The back wall swings open.", fact_ref: "secret.false_wall" }] },
    MOONLIT_CELLAR, engine);
  assert.ok(brief);
});

test("schema violations reject: missing required fields, wrong shapes", () => {
  const engine = sessionWithReveals();
  assert.throws(() => validateBrief({ beat_id: "x" }, MOONLIT_CELLAR, engine), BriefRejection);
  assert.throws(() => validateBrief({ ...goodBrief(), tone: {} }, MOONLIT_CELLAR, engine), BriefRejection);
  assert.throws(() => validateBrief({ ...goodBrief(), extra_channel: "data" }, MOONLIT_CELLAR, engine), BriefRejection);
  assert.throws(() => validateBrief(null, MOONLIT_CELLAR, engine), BriefRejection);
});

test("the Narrator context contains the brief and transcript — and nothing else", () => {
  const engine = sessionWithReveals();
  engine.declare("pc.rogue", "I look around.");
  engine.recordNarration("The dark presses in.");
  const brief = validateBrief(goodBrief(), MOONLIT_CELLAR, engine);
  const messages = assembleNarratorContext(brief, revealedTranscript(engine));
  assert.equal(messages.length, 2); // system + one user turn, stateless per call
  const all = JSON.stringify(messages);
  for (const f of MOONLIT_CELLAR.facts.filter(f => f.scope === "gm")) {
    assert.ok(!all.includes(f.id), `gm fact id ${f.id} reached the Narrator context`);
    assert.ok(!all.includes(f.text), `gm fact text reached the Narrator context`);
  }
  assert.ok(!all.toLowerCase().includes("veska"), "the planted secret reached the Narrator context");
  assert.ok(all.includes("I look around."), "revealed transcript missing");
});

test("the revealed transcript carries only public declarations and narration", () => {
  const engine = sessionWithReveals();
  engine.declare("pc.rogue", "I sneak in.");
  engine.recordNarration("Dust swirls.");
  engine.engineCheck({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "stealth", dc: 13 });
  const t = revealedTranscript(engine);
  assert.ok(t.includes("pc.rogue: I sneak in."));
  assert.ok(t.includes("Pip: Dust swirls."));
  assert.ok(!t.includes("13"), "a DC reached the transcript");
});

test("partyRevealedFactIds tracks the engine's fact fold", () => {
  const engine = newSession(2);
  assert.equal(partyRevealedFactIds(engine).size, 0);
  engine.revealFact("fact.crates", "party", "crates");
  engine.revealFact("fact.lantern_smell", ["pc.rogue"], "oil"); // private ≠ party
  const ids = partyRevealedFactIds(engine);
  assert.deepEqual([...ids], ["fact.crates"]);
});
