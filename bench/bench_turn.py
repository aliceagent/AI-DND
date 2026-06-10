"""Bench 1 — full interactive turn.

PTT clip (synthesized) -> faster-whisper -> Director tool call (streamed)
-> Narrator (streamed) -> Kokoro TTS first chunk.

Gates: transcript <= 0.7s, Director first token <= 2.0s,
       first audible syllable <= 4.0s (all measured from clip end).
"""
import io, time, json, statistics as st
import numpy as np, soundfile as sf
from common import (CFG, log_result, chat_stream, sentences,
                    DIRECTOR_STATIC, DIRECTOR_TOOLS, PLAYER_DECLARATION,
                    NARRATION_BRIEF, NARRATOR_SYSTEM)

# ---- load models once ------------------------------------------------------
from faster_whisper import WhisperModel
from kokoro import KPipeline

print("loading STT…")
stt = WhisperModel(CFG["stt"]["model"], device=CFG["stt"]["device"],
                   compute_type=CFG["stt"]["compute_type"])
print("loading TTS…")
tts = KPipeline(lang_code="a")
VOICE = CFG["tts"]["voice"]
SR = CFG["tts"]["sample_rate"]


def synth_clip(text: str) -> np.ndarray:
    chunks = [audio for _, _, audio in tts(text, voice=VOICE)]
    return np.concatenate(chunks)


def tts_first_chunk_latency(sentence: str) -> float:
    t0 = time.perf_counter()
    for _ in tts(sentence, voice=VOICE):
        return time.perf_counter() - t0
    return float("inf")


def one_turn(clip: np.ndarray) -> dict:
    m = {}
    t_end_of_clip = time.perf_counter()

    # 1) STT
    buf = io.BytesIO(); sf.write(buf, clip, SR, format="WAV"); buf.seek(0)
    segs, _ = stt.transcribe(buf, beam_size=CFG["stt"]["beam_size"], language="en")
    transcript = " ".join(s.text for s in segs).strip()
    m["transcript_s"] = time.perf_counter() - t_end_of_clip

    # 2) Director -> must yield a parseable resolve_check
    messages = [{"role": "system", "content": DIRECTOR_STATIC},
                {"role": "user", "content": f"DECLARATION (Kael): {transcript}\n"
                                            f"Respond with the appropriate tool call."}]
    tool_ok, args = False, None
    frags = []
    for ev, d in chat_stream(messages, CFG["llm"]["director_max_tokens"],
                             tools=DIRECTOR_TOOLS,
                             extra={"tool_choice": "auto"}):
        if ev == "first_token":
            m["director_first_token_s"] = (time.perf_counter() - t_end_of_clip)
        elif ev == "token" and d.get("tool_calls"):
            for tc in d["tool_calls"]:
                frags.append(tc.get("function", {}).get("arguments") or "")
        elif ev == "done":
            m["director_total_s"] = time.perf_counter() - t_end_of_clip
            m["director_decode_tok_s"] = d["decode_tok_s"]
    try:
        args = json.loads("".join(frags)); tool_ok = "dc_hidden" in args
    except Exception:
        pass
    m["director_tool_parsed"] = tool_ok

    # 3) Narrator (engine resolution is ~0ms deterministic; brief is canned)
    n_msgs = [{"role": "system", "content": NARRATOR_SYSTEM},
              {"role": "user", "content": f"BRIEF:\n{NARRATION_BRIEF}"}]
    first_sentence, text_iter = None, []

    def pieces():
        for ev, d in chat_stream(n_msgs, CFG["llm"]["narrator_max_tokens"]):
            if ev == "first_token":
                m["narrator_first_token_s"] = time.perf_counter() - t_end_of_clip
            elif ev == "token":
                yield d["text"]
            elif ev == "done":
                m["narrator_decode_tok_s"] = d["decode_tok_s"]

    for s in sentences(pieces()):
        first_sentence = s
        break  # Orchestrator starts TTS on first complete sentence
    m["first_sentence_s"] = time.perf_counter() - t_end_of_clip

    # 4) TTS first chunk for that sentence
    m["tts_first_chunk_s"] = tts_first_chunk_latency(first_sentence or "He runs.")
    m["first_syllable_s"] = m["first_sentence_s"] + m["tts_first_chunk_s"]
    return m


def main():
    print("synthesizing PTT clip…")
    clip = synth_clip(PLAYER_DECLARATION)
    print(f"clip = {len(clip)/SR:.1f}s spoken declaration")

    print("warm-up turn (populates prompt cache)…")
    one_turn(clip)

    runs = [one_turn(clip) for _ in range(CFG["bench"]["turn_repeats"])]
    keys = ["transcript_s", "director_first_token_s", "first_syllable_s",
            "director_decode_tok_s", "narrator_decode_tok_s"]
    summary = {k: {"p50": st.median(r[k] for r in runs),
                   "p95": sorted(r[k] for r in runs)[max(0, int(0.95*len(runs))-1)]}
               for k in keys}
    summary["tool_parse_rate"] = sum(r["director_tool_parsed"] for r in runs) / len(runs)

    g = CFG["gates"]
    gates = {
        "transcript": summary["transcript_s"]["p95"] <= g["transcript_s"],
        "director_first_token": summary["director_first_token_s"]["p95"] <= g["director_first_token_s"],
        "first_syllable": summary["first_syllable_s"]["p95"] <= g["first_syllable_s"],
        "tool_parse": summary["tool_parse_rate"] >= 0.9,
    }
    row = log_result("turn", {"summary": summary, "gates": gates, "runs": runs})
    print(json.dumps({"summary": summary, "gates": gates}, indent=2))
    print("PASS" if all(gates.values()) else "FAIL — see fallback ladder in README")


if __name__ == "__main__":
    main()
