/** Canon-capture (build plan §1.2): Pip's concrete world inventions are
 *  extracted post-hoc and either ratified into the event log
 *  (canon_ratified) or flagged for correction — invention is captured,
 *  never silently drifted. The extractor is an LLM pass; the decision rule
 *  is deterministic: an assertion that collides with a leak marker is a
 *  coincidental invention of hidden content and becomes a correction, never
 *  canon. */

import { Engine } from "../../engine/src/engine.js";
import type { LlmClient } from "./llm.js";
import type { ScenePack } from "./scene.js";

export interface CanonResult {
  ratified: string[];     // now in the event log as canon_ratified
  corrections: string[];  // for the Director's next brief (route-around notes)
}

const EXTRACT_SYSTEM = `You read one paragraph of game narration and list the concrete world assertions it INVENTS: named things, objects, layout, history, creatures, exits. Ignore mood, weather words, and restatements of the provided known facts. Reply with ONLY a JSON array of short strings, [] if none.`;

export async function extractAssertions(llm: LlmClient, narration: string,
                                        knownFacts: string[]): Promise<string[]> {
  const res = await llm.chat({
    messages: [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content: `Known facts:\n${knownFacts.map(f => `- ${f}`).join("\n")}\n\nNarration:\n${narration}` },
    ],
    temperature: 0,
  });
  try {
    const arr = JSON.parse(firstJsonArray(res.content ?? "[]"));
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
  } catch { return []; }
}

/** Ratify or flag each assertion. Collisions with the pack's hidden layer
 *  (leak markers) are corrections — Pip guessed at something real, and the
 *  Director must route around it rather than confirm it. */
export function reconcileAssertions(engine: Engine, pack: ScenePack,
                                    assertions: string[], causes?: number): CanonResult {
  const ratified: string[] = [];
  const corrections: string[] = [];
  for (const a of assertions) {
    const lower = a.toLowerCase();
    if (pack.leakMarkers.some(m => lower.includes(m))) corrections.push(a);
    else { engine.ratifyCanon(a, "narrator", causes); ratified.push(a); }
  }
  return { ratified, corrections };
}

export async function captureCanon(llm: LlmClient, engine: Engine, pack: ScenePack,
                                   narration: string, causes?: number): Promise<CanonResult> {
  const known = pack.facts.filter(f => f.scope === "party").map(f => f.text);
  const assertions = await extractAssertions(llm, narration, known);
  return reconcileAssertions(engine, pack, assertions, causes);
}

function firstJsonArray(s: string): string {
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  return start >= 0 && end > start ? s.slice(start, end + 1) : "[]";
}
