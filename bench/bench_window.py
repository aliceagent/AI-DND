"""Bench 2 — the narration-window trick under contention.

While a simulated 25s Pip playback window is open, run SDXL-Turbo image
generation and, concurrently, keep the LLM decoding (Narrator-style stream)
and TTS synthesizing. Measure degradation vs. uncontended baselines.

Gates: LLM decode tok/s degradation <= 30%; TTS real-time factor < 0.5
       during image gen; image completes within the window.
"""
import time, json, threading, statistics as st
import numpy as np
from common import CFG, log_result, chat_stream, NARRATOR_SYSTEM, NARRATION_BRIEF

from kokoro import KPipeline
import torch
from diffusers import AutoPipelineForText2Image

print("loading TTS…")
tts = KPipeline(lang_code="a")
VOICE = CFG["tts"]["voice"]; SR = CFG["tts"]["sample_rate"]

print("loading SDXL-Turbo…")
img_pipe = AutoPipelineForText2Image.from_pretrained(
    CFG["image"]["model"], torch_dtype=torch.float16).to("cuda")

NARR_MSGS = [{"role": "system", "content": NARRATOR_SYSTEM},
             {"role": "user", "content": f"BRIEF:\n{NARRATION_BRIEF}\n"
                                         f"Write ~12 sentences this time."}]
TTS_TEXT = ("The street narrows between the well and the burning stable, "
            "smoke folding over the rooftops as you run.") * 3
IMG_PROMPT = ("night raid on a small medieval town, burning thatched stable, "
              "stone keep on a hill in the distance, cinematic, painterly")


def llm_decode_tok_s() -> float:
    for ev, d in chat_stream(NARR_MSGS, CFG["llm"]["narrator_max_tokens"]):
        if ev == "done":
            return d["decode_tok_s"]
    return 0.0


def tts_rtf() -> float:
    """Real-time factor: synth_time / audio_time (lower is better)."""
    t0 = time.perf_counter(); dur = 0.0
    for _, _, audio in tts(TTS_TEXT, voice=VOICE):
        dur += len(audio) / SR
    return (time.perf_counter() - t0) / max(dur, 1e-6)


def gen_image() -> float:
    t0 = time.perf_counter()
    img_pipe(prompt=IMG_PROMPT, num_inference_steps=CFG["image"]["steps"],
             guidance_scale=0.0, width=CFG["image"]["width"],
             height=CFG["image"]["height"])
    return time.perf_counter() - t0


def main():
    print("baselines (uncontended)…")
    base_llm = st.median(llm_decode_tok_s() for _ in range(3))
    base_rtf = tts_rtf()
    base_img = gen_image()
    print(f"  llm {base_llm:.1f} tok/s | tts rtf {base_rtf:.2f} | image {base_img:.1f}s")

    print("contended run: image gen inside narration window…")
    results = {"img_s": None}
    t_img = threading.Thread(target=lambda: results.update(img_s=gen_image()))
    window = CFG["bench"]["window_narration_seconds"]
    t0 = time.perf_counter()
    t_img.start()
    cont_llm = llm_decode_tok_s()          # P0 work continues during P1 image
    cont_rtf = tts_rtf()
    t_img.join()
    elapsed = time.perf_counter() - t0

    deg = 100 * (1 - cont_llm / max(base_llm, 1e-6))
    gates = {
        "llm_degradation": deg <= CFG["gates"]["decode_degradation_pct"],
        "tts_rtf": cont_rtf < 0.5,
        "image_in_window": results["img_s"] <= window,
    }
    summary = {"base_llm_tok_s": base_llm, "contended_llm_tok_s": cont_llm,
               "degradation_pct": deg, "base_tts_rtf": base_rtf,
               "contended_tts_rtf": cont_rtf, "image_s_contended": results["img_s"],
               "window_s": window, "elapsed_s": elapsed}
    log_result("window", {"summary": summary, "gates": gates})
    print(json.dumps({"summary": summary, "gates": gates}, indent=2))
    print("PASS" if all(gates.values()) else
          "FAIL — demote improv images to longer windows or smaller res")


if __name__ == "__main__":
    main()
