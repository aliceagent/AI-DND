/** Spark day-one preflight: prove the model endpoint end-to-end before
 *  debugging anything else. Checks, in order: endpoint reachable, model
 *  present, plain generation, tool-call round trip. Prints latencies,
 *  exits non-zero on the first failure.
 *
 *    HERMYS_LLM_BASE_URL=… HERMYS_LLM_MODEL=… npm run preflight */

import { HttpLlm, envConfig } from "./llm.js";

const { baseUrl, model } = envConfig();
console.log(`preflight: ${model} @ ${baseUrl}`);

const t0 = Date.now();
const step = (name: string, ms: number, detail = "") =>
  console.log(`  ✓ ${name} (${ms} ms)${detail ? ` — ${detail}` : ""}`);

try {
  // 1. endpoint reachable + model listed
  let t = Date.now();
  const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`/models → ${res.status}`);
  const models = ((await res.json()).data ?? []).map((m: any) => m.id);
  if (!models.includes(model))
    console.warn(`  ⚠ model "${model}" not in /models (${models.slice(0, 5).join(", ")}…) — continuing`);
  step("endpoint reachable", Date.now() - t, `${models.length} model(s)`);

  const llm = new HttpLlm();

  // 2. plain generation
  t = Date.now();
  const gen = await llm.chat({ messages: [
    { role: "system", content: "Answer with exactly one word." },
    { role: "user", content: "What color is a clear noon sky?" } ], temperature: 0 });
  if (!gen.content?.trim()) throw new Error("empty generation");
  step("generation", Date.now() - t, JSON.stringify(gen.content.trim().slice(0, 30)));

  // 3. tool-call round trip (the Director's lifeline)
  t = Date.now();
  const tool = await llm.chat({
    messages: [{ role: "user", content: "Reveal the fact 'cellar_dark' to the party using the tool." }],
    tools: [{ type: "function", function: { name: "reveal_fact", description: "Reveal a fact to players",
      parameters: { type: "object", properties: { fact_id: { type: "string" }, to: { type: "string" } },
        required: ["fact_id", "to"] } } }],
    temperature: 0,
  });
  const call = tool.toolCalls[0];
  if (!call || call.name !== "reveal_fact") throw new Error(`no tool call (got: ${JSON.stringify(tool).slice(0, 120)})`);
  const args = JSON.parse(call.arguments);
  if (!args.fact_id) throw new Error("tool call missing fact_id");
  step("tool-call round trip", Date.now() - t, call.arguments);

  console.log(`preflight PASSED in ${Date.now() - t0} ms — proceed to hotseat, then redteam`);
} catch (e) {
  console.error(`  ✗ ${String((e as Error).message ?? e)}`);
  console.error("preflight FAILED — fix the endpoint before touching anything downstream");
  process.exit(1);
}
