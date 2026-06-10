/** The Director (Tally) loop: declaration in → tool calls against the
 *  engine → a validated Narration Brief out. A loop, not a chat. The brief
 *  passes through validateBrief (the safety boundary) before anyone may use
 *  it; a rejected brief is fed back to the Director exactly once, then the
 *  turn fails loudly — never silently, never around the gate. */

import { Engine } from "../../engine/src/engine.js";
import type { LlmClient, ChatMessage } from "./llm.js";
import { DIRECTOR_TOOLS, SEND_BRIEF, executeTool } from "./tools.js";
import { assembleDirectorContext, validateBrief, BriefRejection } from "./context.js";
import type { ScenePack } from "./scene.js";

export interface DirectorTurn {
  brief: Record<string, unknown>;
  toolLog: { name: string; args: string; result: string }[];
  rejections: BriefRejection[];
}

export async function runDirectorTurn(
  llm: LlmClient, engine: Engine, pack: ScenePack,
  declaration: { actor: string; text: string } | null,
  opts: { maxSteps?: number; temperature?: number } = {},
): Promise<DirectorTurn> {
  const maxSteps = opts.maxSteps ?? 12;
  const messages: ChatMessage[] = assembleDirectorContext(engine, pack, declaration);
  const toolLog: DirectorTurn["toolLog"] = [];
  const rejections: BriefRejection[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const res = await llm.chat({ messages, tools: [...DIRECTOR_TOOLS], temperature: opts.temperature ?? 0.3 });

    if (!res.toolCalls.length) {
      // Directors don't talk; nudge once per occurrence.
      messages.push({ role: "assistant", content: res.content ?? "" });
      messages.push({ role: "user",
        content: "You must act through tool calls only, and end with send_narration_brief." });
      continue;
    }

    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });

    for (const call of res.toolCalls) {
      if (call.name === SEND_BRIEF) {
        let parsed: unknown;
        // lenient parse — small models sometimes skip the {brief: …} wrapper;
        // validation still gates everything that matters
        try { const obj = JSON.parse(call.arguments); parsed = obj?.brief ?? obj; }
        catch { parsed = undefined; }
        try {
          const brief = validateBrief(parsed, pack, engine);
          return { brief, toolLog, rejections };
        } catch (e) {
          if (!(e instanceof BriefRejection)) throw e;
          rejections.push(e);
          if (rejections.length > 1) throw e;       // one retry, then fail loudly
          messages.push({ role: "tool", tool_call_id: call.id,
            content: JSON.stringify({ rejected: e.reasons }) });
          continue;
        }
      }
      const result = executeTool(engine, call.name, call.arguments);
      toolLog.push({ name: call.name, args: call.arguments, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  throw new Error(`Director did not produce a brief within ${maxSteps} steps`);
}
