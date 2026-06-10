# Hermys — Phase 0 Bench

Go/no-go benchmark for the DGX Spark before any product code. Proves (or prices)
the concurrency plan in Part 4.3 of the build plan.

## What gets measured

| # | Bench | Question it answers | Gate |
|---|---|---|---|
| 1 | `bench/bench_turn.py` | Full interactive turn: PTT clip → STT → Director (tool call) → Narrator (stream) → TTS first audio | transcript ≤ **0.7 s**, Director first token ≤ **2.0 s**, first audible syllable ≤ **4.0 s** from clip end |
| 2 | `bench/bench_window.py` | Does SDXL-Turbo image gen *during narration playback* tank LLM/TTS throughput? | LLM decode tok/s degradation ≤ **30%**; TTS real-time factor stays < 0.5 while image renders |
| 3 | `bench/bench_cache.py` | Prompt-cache effectiveness: static Director context (module + system) cached vs cold | warm TTFT ≤ **25%** of cold TTFT |
| 4 | `bench/bench_residency.py` | Steady-state memory with everything loaded | total resident ≤ **100 GB** (head-room for KV cache growth) |

If gate 1 fails after gate 3's caching is applied, work the fallback ladder from
the build plan §4.3 before touching cloud: (a) Director reasoning-effort low
in-turn + anticipatory planning between turns, (b) Narrator on Qwen3-30B-A3B,
(c) owner sign-off for any cloud spillover.

## Prerequisites on the Spark

```bash
# 1. llama.cpp server with GPT-OSS-120B (MXFP4 GGUF), OpenAI-compatible API
llama-server -m gpt-oss-120b-mxfp4.gguf --port 8080 -ngl 999 \
  --ctx-size 32768 --cache-reuse 256 --jinja

# 2. Python env (aarch64)
python3 -m venv .venv && source .venv/bin/activate
pip install faster-whisper kokoro soundfile numpy requests pyyaml psutil
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126  # or NVIDIA's aarch64 wheel
pip install diffusers transformers accelerate

# 3. Models pulled on first run:
#    faster-whisper: large-v3-turbo (auto-download)
#    kokoro: hexgrad/Kokoro-82M (auto-download)
#    diffusers: stabilityai/sdxl-turbo (auto-download)
```

Copy `bench/config.yaml.example` to `bench/config.yaml` and edit (endpoints, model ids, repeat counts), then:

```bash
python bench/bench_residency.py        # load everything, report memory
python bench/bench_cache.py            # cold vs warm TTFT
python bench/bench_turn.py             # the headline number, 10 reps
python bench/bench_window.py           # contention test
```

Each script appends a row to `results.jsonl` and prints a markdown summary.
`python bench/report.py` collates everything into `RESULTS.md` with PASS/FAIL
per gate.

## Notes

- **No microphone needed.** `bench_turn.py` synthesizes the "player PTT clip"
  with Kokoro itself (a spoken action declaration), so the bench is fully
  self-contained and repeatable.
- **Director realism.** The Director prompt in `bench/prompts.py` includes a
  ~6k-token static block (stand-in for module + system + tools) so prompt
  caching is tested against realistic context, plus a real tool schema —
  the call must produce a parseable `resolve_check` tool invocation to count.
- **Narrator realism.** The Narrator request streams; we record TTFT and
  per-sentence boundaries, and TTS starts on the *first complete sentence*,
  exactly as the Orchestrator will do.
- Run benches 1–3 with the SDXL worker **loaded but idle** — residency is
  realistic even when contention isn't being tested.
