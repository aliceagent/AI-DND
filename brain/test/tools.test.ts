/** The engine command API as an OpenAI tool schema: shapes are valid tool
 *  definitions, the dispatcher drives the real engine, and engine refusals
 *  come back as readable error payloads. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTOR_TOOLS, executeTool, SEND_BRIEF } from "../src/tools.js";
import { newSession } from "../src/session.js";

test("every tool is a well-formed OpenAI function definition", () => {
  assert.ok(DIRECTOR_TOOLS.length >= 12);
  for (const t of DIRECTOR_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name.match(/^[a-z_]+$/), t.function.name);
    assert.ok(t.function.description.length > 20, `${t.function.name} needs a real description`);
    const p = t.function.parameters as any;
    assert.equal(p.type, "object");
    assert.equal(p.additionalProperties, false);
    for (const req of p.required) assert.ok(p.properties[req], `${t.function.name}.${req} required but undeclared`);
  }
  assert.ok(DIRECTOR_TOOLS.some(t => t.function.name === SEND_BRIEF));
});

test("the dispatcher drives the engine: check → roll → state", () => {
  const engine = newSession(30);
  const r = JSON.parse(executeTool(engine, "call_check",
    JSON.stringify({ actor: "pc.rogue", kind: "check", ability: "dex", skill: "stealth", dc: 12 })));
  assert.equal(r.status, "awaiting_player_roll");
  assert.ok(engine.state().pendingChecks[r.checkId]);
  engine.reportCheckRoll(r.checkId, [14]);
  const state = JSON.parse(executeTool(engine, "query_state", "{}"));
  assert.equal(Object.keys(state.pendingChecks).length, 0);
});

test("secret tools stay secret: engine_check and passive_check emit no public events", () => {
  const engine = newSession(31);
  const before = engine.store.visibleTo("pc.rogue").length;
  executeTool(engine, "engine_check",
    JSON.stringify({ actor: "pc.rogue", kind: "save", ability: "wis", dc: 11 }));
  executeTool(engine, "passive_check",
    JSON.stringify({ actor: "pc.rogue", skill: "perception", dc: 13 }));
  assert.equal(engine.store.visibleTo("pc.rogue").length, before);
});

test("engine refusals are readable tool errors, not exceptions", () => {
  const engine = newSession(32);
  const r = JSON.parse(executeTool(engine, "cast_spell",
    JSON.stringify({ caster: "pc.fighter", level: 1 })));
  assert.ok(r.error.includes("no level-1 slot"));
  const unknown = JSON.parse(executeTool(engine, "summon_dragon", "{}"));
  assert.ok(unknown.error.includes("unknown tool"));
});

test("reveal_fact through the tool surface lands in the fold", () => {
  const engine = newSession(33);
  executeTool(engine, "reveal_fact",
    JSON.stringify({ fact_id: "fact.crates", to: "party", text: "Rotting crates line the walls." }));
  assert.deepEqual(engine.state().facts["fact.crates"], ["*"]);
});
