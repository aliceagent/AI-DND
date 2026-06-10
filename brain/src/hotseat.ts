/** Hotseat CLI session runner (mac-week §3): type declarations, type rolls.
 *  One human plays every chair; the engine and the two-tier brain do the
 *  rest. Requires a local OpenAI-compatible model:
 *    HERMYS_LLM_BASE_URL (default http://localhost:11434/v1)
 *    HERMYS_LLM_MODEL    (default qwen3:4b)
 *
 *  Commands:
 *    <actor>: <declaration>     e.g.  pc.rogue: I check the desk for traps
 *    /roll <checkId> <d20 ...>  report dice for a called check
 *    /recap [charId|party]      the filtered-fold recap
 *    /state                     your Box view of a character (no gm data)
 *    /export <file>             JSONL event log (the leak-audit artifact)
 *    /quit                      */

import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { HttpLlm, envConfig } from "./llm.js";
import { newSession, playTurn, pendingRolls } from "./session.js";
import { MOONLIT_CELLAR } from "./scene.js";
import { renderRecap } from "./recap.js";
import { PCS } from "../../engine/src/srd.js";

const llm = new HttpLlm();
const engine = newSession(Number(process.argv[2] ?? 1234));
const pack = MOONLIT_CELLAR;
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log(`Hermys hotseat — ${pack.title}`);
console.log(`model: ${envConfig().model} @ ${envConfig().baseUrl}`);
console.log(`party: ${PCS.map(p => p.ref).join(", ")}\n`);

const opening = await playTurn(llm, engine, pack, null);
say(opening.narration);

for (;;) {
  for (const p of pendingRolls(engine))
    console.log(`  ⚄ roll owed: #${p.id} ${p.actor} ${p.ability}${p.skill ? ` (${p.skill})` : ""} ${p.advantage !== "none" ? p.advantage : ""} — /roll ${p.id} <d20>`);
  const line = (await rl.question("> ")).trim();
  if (!line) continue;

  if (line === "/quit") break;
  if (line.startsWith("/recap")) {
    console.log(renderRecap(engine.store, line.split(/\s+/)[1] ?? "party"));
    continue;
  }
  if (line.startsWith("/state")) {
    const who = line.split(/\s+/)[1] ?? PCS[0].ref;
    const c = engine.state().combatants[who];
    console.log(c ? `${c.name}: ${c.hp}/${c.maxHp} hp, conditions: ${c.conditions.join(", ") || "none"}`
                  : `unknown: ${who}`);
    continue;
  }
  if (line.startsWith("/export")) {
    const file = line.split(/\s+/)[1] ?? "session.jsonl";
    writeFileSync(file, engine.store.toJSONL());
    console.log(`wrote ${file}`);
    continue;
  }
  if (line.startsWith("/roll")) {
    const [, id, ...dice] = line.split(/\s+/);
    try {
      engine.reportCheckRoll(Number(id), dice.map(Number));
      const after = await playTurn(llm, engine, pack, {
        actor: "table", text: `(rolled ${dice.join(", ")} for check #${id})` });
      say(after.narration);
    } catch (e) { console.error(String((e as Error).message)); }
    continue;
  }

  const m = line.match(/^([\w.]+):\s*(.+)$/);
  if (!m) { console.log("say it as  <actor>: <declaration>  (or /quit, /recap, /roll …)"); continue; }
  try {
    const turn = await playTurn(llm, engine, pack, { actor: m[1], text: m[2] });
    say(turn.narration);
    if (turn.canon?.ratified.length)
      console.log(`  (canon: ${turn.canon.ratified.join(" | ")})`);
  } catch (e) { console.error(String((e as Error).message)); }
}

rl.close();

function say(text: string) { console.log(`\nPip: ${text}\n`); }
