/** The Narrator (Pip) route. Stateless per call. Defense in depth: this
 *  module re-validates the brief itself — even a caller that skipped the
 *  Director loop cannot hand Pip an unvalidated brief. */

import { Engine } from "../../engine/src/engine.js";
import type { LlmClient } from "./llm.js";
import { assembleNarratorContext, validateBrief, revealedTranscript } from "./context.js";
import type { ScenePack } from "./scene.js";

export async function narrate(
  llm: LlmClient, engine: Engine, pack: ScenePack,
  brief: Record<string, unknown>,
  opts: { temperature?: number } = {},
): Promise<string> {
  const validated = validateBrief(brief, pack, engine);   // throws BriefRejection
  const messages = assembleNarratorContext(validated, revealedTranscript(engine));
  const res = await llm.chat({ messages, temperature: opts.temperature ?? 0.8 });
  return (res.content ?? "").trim();
}
