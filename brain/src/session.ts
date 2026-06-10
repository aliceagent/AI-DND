/** One full text-mode turn: declaration → Director (tools + brief) →
 *  validated brief → Pip → narration recorded into the event log →
 *  canon-capture. Shared by the hotseat CLI and the red-team harness. */

import { Engine } from "../../engine/src/engine.js";
import { PCS } from "../../engine/src/srd.js";
import type { LlmClient } from "./llm.js";
import { runDirectorTurn, type DirectorTurn } from "./director.js";
import { narrate } from "./narrator.js";
import { captureCanon, type CanonResult } from "./canon.js";
import type { ScenePack } from "./scene.js";

export interface TurnResult {
  narration: string;
  director: DirectorTurn;
  canon: CanonResult | null;
}

export function newSession(seed = 1234): Engine {
  const engine = new Engine(seed);
  for (const pc of PCS) engine.join(pc.ref, pc);
  return engine;
}

export async function playTurn(
  llm: LlmClient, engine: Engine, pack: ScenePack,
  declaration: { actor: string; text: string } | null,
  opts: { canon?: boolean } = {},
): Promise<TurnResult> {
  if (declaration) engine.declare(declaration.actor, declaration.text);
  const director = await runDirectorTurn(llm, engine, pack, declaration);
  const narration = await narrate(llm, engine, pack, director.brief);
  const ev = engine.recordNarration(narration, String(director.brief.beat_id ?? ""));
  let canon: CanonResult | null = null;
  if (opts.canon !== false) {
    try { canon = await captureCanon(llm, engine, pack, narration, ev.id); }
    catch { canon = null; } // capture is best-effort; the gate is the assembler
  }
  return { narration, director, canon };
}

/** Outstanding hidden-DC checks the table owes rolls for. */
export function pendingRolls(engine: Engine) {
  return Object.values(engine.state().pendingChecks).filter(p => p.rolls === null);
}
