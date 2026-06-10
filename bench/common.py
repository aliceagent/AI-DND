"""Shared helpers + realistic prompts for the Phase 0 bench suite."""
import json, time, pathlib, yaml, requests

ROOT = pathlib.Path(__file__).resolve().parent
CFG = yaml.safe_load((ROOT / "config.yaml").read_text())


def log_result(bench: str, payload: dict):
    row = {"bench": bench, "ts": time.time(), **payload}
    with open(ROOT / CFG["bench"]["results_file"], "a") as f:
        f.write(json.dumps(row) + "\n")
    return row


# ---------------------------------------------------------------- LLM client
def chat_stream(messages, max_tokens, tools=None, extra=None):
    """Stream a chat completion; yield (event, data) where event is
    'first_token' | 'token' | 'done'. Measures TTFT at the transport level."""
    body = {
        "model": CFG["llm"]["model"],
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": True,
        "cache_prompt": CFG["llm"]["cache_prompt"],  # llama.cpp extension; ignored elsewhere
    }
    if tools:
        body["tools"] = tools
    if extra:
        body.update(extra)
    t0 = time.perf_counter()
    first = None
    n_tokens = 0
    with requests.post(
        f"{CFG['llm']['base_url']}/chat/completions",
        headers={"Authorization": f"Bearer {CFG['llm']['api_key']}"},
        json=body, stream=True, timeout=600,
    ) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line or not line.startswith(b"data: "):
                continue
            data = line[6:]
            if data == b"[DONE]":
                break
            chunk = json.loads(data)
            delta = chunk["choices"][0].get("delta", {})
            piece = delta.get("content") or ""
            tc = delta.get("tool_calls")
            if piece or tc:
                n_tokens += 1
                if first is None:
                    first = time.perf_counter() - t0
                    yield "first_token", {"ttft_s": first}
                yield "token", {"text": piece, "tool_calls": tc}
    dt = time.perf_counter() - t0
    yield "done", {
        "ttft_s": first, "total_s": dt, "n_chunks": n_tokens,
        "decode_tok_s": (n_tokens - 1) / max(dt - (first or 0), 1e-6),
    }


# ----------------------------------------------------------------- Prompts
# ~6k-token static Director block stand-in: module digest + system + rules.
# Padded deterministically so prompt-cache tests are honest.
_PAD_FACT = (
    "Beat record %03d: a keyed scene with entry conditions, two gated secrets, "
    "an exit edge to the keep hub, a clock cost of one hour, and a stochastic "
    "encounter hook drawing from the episode table. Reveal tags pending review. "
)
DIRECTOR_STATIC = (
    "You are the Tally, the all-seeing Director of a tabletop game engine. You "
    "never address players. You receive game state and a player declaration; "
    "you respond ONLY with tool calls. Hidden DCs are never exposed. The town "
    "is under night attack; the party escorts a family toward the keep.\n\n"
    "MODULE DIGEST (private):\n" + "".join(_PAD_FACT % i for i in range(220))
)

DIRECTOR_TOOLS = [{
    "type": "function",
    "function": {
        "name": "resolve_check",
        "description": "Request an ability check or save from a character.",
        "parameters": {
            "type": "object",
            "properties": {
                "actor": {"type": "string"},
                "kind": {"type": "string", "enum": ["check", "save", "attack"]},
                "ability": {"type": "string"},
                "skill": {"type": ["string", "null"]},
                "dc_hidden": {"type": "integer"},
                "advantage": {"type": "string", "enum": ["none", "adv", "dis"]},
            },
            "required": ["actor", "kind", "ability", "dc_hidden", "advantage"],
        },
    },
}]

PLAYER_DECLARATION = (
    "I grab the youngest kid, throw my cloak over us both, and sprint for the "
    "gap between the burning stable and the well — trying to stay out of the "
    "kobolds' line of sight."
)

NARRATION_BRIEF = json.dumps({
    "scene": "night street, burning stables, family fleeing, kobold pack",
    "facts": ["check succeeded", "child carried to cover", "kobolds distracted by the blaze"],
    "sanctioned_hints": ["a vast wingbeat passes somewhere above the smoke"],
    "negative_constraints": ["do not name the dragon", "do not describe the keep interior"],
    "tone": "urgent, cinematic, second person, <= 4 sentences",
    "spotlight": "Kael",
})

NARRATOR_SYSTEM = (
    "You are Pip, the Narrator. Narrate ONLY from the brief. Obey every "
    "negative constraint. Vivid, spoken-aloud prose. End cleanly."
)


def sentences(text_stream):
    """Yield complete sentences from an incremental text stream (TTS chunking)."""
    buf = ""
    for piece in text_stream:
        buf += piece
        while True:
            cut = max(buf.find(". "), buf.find("! "), buf.find("? "))
            if cut == -1:
                break
            yield buf[: cut + 1].strip()
            buf = buf[cut + 2:]
    if buf.strip():
        yield buf.strip()
