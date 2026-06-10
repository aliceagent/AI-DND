"""Bench 4 — steady-state residency.

Loads everything the live system keeps warm (STT, TTS, SDXL — the LLM lives in
llama-server, measured via its process) and reports unified-memory usage.
Gate: total resident <= 100 GB (leaves head-room for KV growth + OS).
On GB10 unified memory, system-wide used memory is the honest number.
"""
import json, subprocess, psutil
from common import CFG, log_result


def gb(x): return round(x / 1e9, 1)


def main():
    print("loading warm set…")
    from faster_whisper import WhisperModel
    from kokoro import KPipeline
    import torch
    from diffusers import AutoPipelineForText2Image

    _stt = WhisperModel(CFG["stt"]["model"], device="cuda", compute_type="float16")
    _tts = KPipeline(lang_code="a")
    _img = AutoPipelineForText2Image.from_pretrained(
        CFG["image"]["model"], torch_dtype=torch.float16).to("cuda")

    vm = psutil.virtual_memory()
    used = vm.total - vm.available
    # llama-server share, if visible
    llama_rss = sum(p.memory_info().rss for p in psutil.process_iter(["name"])
                    if "llama" in (p.info["name"] or "").lower())

    summary = {"system_used_gb": gb(used), "system_total_gb": gb(vm.total),
               "llama_server_rss_gb": gb(llama_rss)}
    try:
        smi = subprocess.run(["nvidia-smi", "--query-gpu=memory.used",
                              "--format=csv,noheader"], capture_output=True, text=True)
        summary["nvidia_smi"] = smi.stdout.strip()
    except FileNotFoundError:
        pass

    gates = {"residency": summary["system_used_gb"] <= CFG["gates"]["resident_gb"]}
    log_result("residency", {"summary": summary, "gates": gates})
    print(json.dumps({"summary": summary, "gates": gates}, indent=2))
    print("PASS" if all(gates.values()) else "FAIL — trim the warm set or quantize")


if __name__ == "__main__":
    main()
