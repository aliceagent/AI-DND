/** The Director loop: tool calls execute against the engine, the turn ends
 *  with a validated brief, and a leaky brief gets exactly one feedback
 *  retry before the turn fails loudly. MockLlm keeps it deterministic. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLlm, toolCall, textReply } from "../src/llm.js";
import { runDirectorTurn } from "../src/director.js";
import { narrate } from "../src/narrator.js";
import { newSession } from "../src/session.js";
import { MOONLIT_CELLAR } from "../src/scene.js";
import { BriefRejection } from "../src/context.js";

const CLEAN_BRIEF = {
  beat_id: "beat.cellar_search",
  scene_facts: [{ text: "The cellar is dark.", fact_ref: null, emphasis: "lead" }],
  negative_constraints: ["do not describe the back wall"],
  tone: { register: "dread" },
  delivery: { max_sentences: 4 },
};

test("a turn executes tools against the engine, then returns the validated brief", async () => {
  const engine = newSession(10);
  const llm = new MockLlm([
    toolCall("reveal_fact", { fact_id: "fact.cellar_dark", to: "party", text: "The cellar is dark." }),
    toolCall("engine_check", { actor: "pc.rogue", kind: "check", ability: "wis", skill: "perception", dc: 13 }),
    toolCall("send_narration_brief", { brief: CLEAN_BRIEF }),
  ]);
  const turn = await runDirectorTurn(llm, engine, MOONLIT_CELLAR, { actor: "pc.rogue", text: "I look around." });

  assert.equal(turn.toolLog.length, 2);
  assert.equal(turn.rejections.length, 0);
  assert.equal(turn.brief.beat_id, "beat.cellar_search");
  // the tools really hit the engine: the reveal is in the fold, the check in the log
  assert.deepEqual(engine.state().facts["fact.cellar_dark"], ["*"]);
  assert.ok(engine.store.timeline().some(e => e.type === "check_resolved"));
  // and the Director context (request 1) carried the gm-only pack layer
  const directorSaw = JSON.stringify(llm.requests[0].messages);
  assert.ok(directorSaw.includes("secret.veska_thorn"), "Director must see everything");
});

test("GATE: a leaky brief is rejected, fed back once, then the turn fails loudly", async () => {
  const engine = newSession(11);
  const leaky = { ...CLEAN_BRIEF,
    sanctioned_hints: ["whisper of secret.veska_thorn behind the stone"] };
  const llm = new MockLlm([
    toolCall("send_narration_brief", { brief: leaky }),
    toolCall("send_narration_brief", { brief: leaky }), // doubles down — no second chance
  ]);
  await assert.rejects(
    runDirectorTurn(llm, engine, MOONLIT_CELLAR, { actor: "pc.rogue", text: "What's hidden?" }),
    BriefRejection);
  // the rejection reasons were fed back into the conversation after attempt 1
  const fedBack = llm.requests[1].messages.at(-1)!;
  assert.equal(fedBack.role, "tool");
  assert.ok((fedBack as any).content.includes("secret.veska_thorn"));
});

test("a rejected brief can be repaired on the single retry", async () => {
  const engine = newSession(12);
  const leaky = { ...CLEAN_BRIEF, sanctioned_hints: ["see secret.false_wall"] };
  const llm = new MockLlm([
    toolCall("send_narration_brief", { brief: leaky }),
    toolCall("send_narration_brief", { brief: CLEAN_BRIEF }),
  ]);
  const turn = await runDirectorTurn(llm, engine, MOONLIT_CELLAR, null);
  assert.equal(turn.rejections.length, 1);
  assert.equal(turn.brief.beat_id, "beat.cellar_search");
});

test("a chatty Director (no tool calls) is nudged back to tools", async () => {
  const engine = newSession(13);
  const llm = new MockLlm([
    textReply("The party enters a dark cellar..."),
    toolCall("send_narration_brief", { brief: CLEAN_BRIEF }),
  ]);
  const turn = await runDirectorTurn(llm, engine, MOONLIT_CELLAR, null);
  assert.equal(turn.brief.beat_id, "beat.cellar_search");
  const nudge = llm.requests[1].messages.at(-1)!;
  assert.ok((nudge as any).content.includes("tool calls only"));
});

test("narrate() re-validates: an unvalidated leaky brief cannot reach Pip directly", async () => {
  const engine = newSession(14);
  const llm = new MockLlm([textReply("should never be called")]);
  const leaky = { ...CLEAN_BRIEF, scene_facts: [{ text: "x", fact_ref: "secret.dawn_buyer" }] };
  await assert.rejects(narrate(llm, engine, MOONLIT_CELLAR, leaky as any), BriefRejection);
  assert.equal(llm.requests.length, 0, "the model was reached despite the rejection");
});

test("engine errors surface to the Director as readable tool results, not crashes", async () => {
  const engine = newSession(15);
  const llm = new MockLlm([
    toolCall("cast_spell", { caster: "pc.fighter", level: 1 }), // martials have no slots
    toolCall("send_narration_brief", { brief: CLEAN_BRIEF }),
  ]);
  const turn = await runDirectorTurn(llm, engine, MOONLIT_CELLAR, null);
  assert.ok(turn.toolLog[0].result.includes("no level-1 slot"));
});
