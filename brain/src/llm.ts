/** Model access. One OpenAI-compatible endpoint, two routes (Director and
 *  Narrator are prompt/context configurations, never separate residents —
 *  build plan §1.3). Endpoint comes from env so the Mac→Spark swap is
 *  config-only: HERMYS_LLM_BASE_URL, HERMYS_LLM_MODEL. */

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall { id: string; name: string; arguments: string }

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
}

export interface ChatResponse { content: string | null; toolCalls: ToolCall[] }

export interface LlmClient { chat(req: ChatRequest): Promise<ChatResponse> }

export function envConfig(): { baseUrl: string; model: string } {
  return {
    baseUrl: process.env.HERMYS_LLM_BASE_URL ?? "http://localhost:11434/v1",
    model: process.env.HERMYS_LLM_MODEL ?? "qwen3:4b",
  };
}

/** Plain fetch against any OpenAI-compatible /chat/completions. */
export class HttpLlm implements LlmClient {
  constructor(private baseUrl = envConfig().baseUrl,
              private model = envConfig().model) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages.map(m =>
        m.role === "assistant"
          ? { role: m.role, content: m.content,
              ...(m.tool_calls?.length ? { tool_calls: m.tool_calls.map(t => ({
                id: t.id, type: "function",
                function: { name: t.name, arguments: t.arguments } })) } : {}) }
          : m),
      temperature: req.temperature ?? 0.7,
      ...(req.tools?.length ? { tools: req.tools } : {}),
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const json = await res.json() as any;
    const msg = json.choices?.[0]?.message ?? {};
    return {
      content: msg.content ?? null,
      toolCalls: (msg.tool_calls ?? []).map((t: any) => ({
        id: t.id ?? `call_${Math.random().toString(36).slice(2)}`,
        name: t.function.name,
        arguments: t.function.arguments,
      })),
    };
  }
}

/** Deterministic scripted client for the gate tests — no model required. */
export class MockLlm implements LlmClient {
  readonly requests: ChatRequest[] = [];
  private queue: ChatResponse[];

  constructor(responses: ChatResponse[]) { this.queue = [...responses]; }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // snapshot — callers mutate their messages array across loop steps
    this.requests.push({ ...req, messages: [...req.messages] });
    const next = this.queue.shift();
    if (!next) throw new Error("MockLlm: script exhausted");
    return next;
  }
}

export const toolCall = (name: string, args: unknown, id = `call_${name}`): ChatResponse =>
  ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

export const textReply = (content: string): ChatResponse => ({ content, toolCalls: [] });
