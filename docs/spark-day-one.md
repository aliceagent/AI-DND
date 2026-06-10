# Spark day one — the handoff runbook

Everything on the Mac was built so this list is configuration and
measurement, not scaffolding. Run in order; each item names its gate.

## 0. Base stack (morning)

1. llama.cpp server (aarch64 + CUDA) with **GPT-OSS-120B MXFP4**; LiteLLM in
   front with two routes (`director` high reasoning effort, `narrator` lower)
   per build plan §4.2. Utility model: Qwen3-4B.
2. Export the only two variables shared code reads:
   ```bash
   export HERMYS_LLM_BASE_URL=http://localhost:4000/v1   # LiteLLM
   export HERMYS_LLM_MODEL=gpt-oss-120b
   ```
3. `cd engine && npm install && npm test` — 53 green (sanity that the clone
   is whole; nothing here touches the GPU).
4. `cd brain && npm install && npm test` — 26 green (MockLlm; same sanity).

## 1. Phase 0 bench (the go/no-go gate)

5. `bench/` per `bench/README.md`: copy config, run, `report.py`.
   **Gate:** turn p95 first-syllable ≤ 4.0 s; transcript ≤ 0.7 s; Director
   first token ≤ 2.0 s; image-gen LLM degradation ≤ 30 %; warm TTFT ≤ 25 %
   of cold; residency ≤ 100 GB. Miss ⇒ the fallback ladder in CLAUDE.md
   (§ Build phases, Phase 0) — do not proceed on a silent miss.

## 2. Phase 2 live gates (afternoon)

5b. `cd brain && npm run preflight` — endpoint reachable, model listed,
   one generation, one tool-call round trip, with latencies. Fix failures
   here before touching anything downstream.
6. Hotseat smoke: `cd brain && npm run hotseat` — play a few honest turns of
   the Moonlit Cellar; confirm tool-calling, the check→roll→resolve loop,
   and canon capture against the real Director route.
7. **The red-team gate:** `npm run redteam` → writes
   `docs/redteam-phase2.md`, exits non-zero on any leak.
   **Gate: zero leaks.** Commit the transcript for external review.
   (The harness forces low rolls so the secret can't be legitimately
   revealed mid-audit; every tripwire hit is a real leak.)
8. If the model fights the OpenAI tool-call shape through LiteLLM, the
   prompt-suffix escape hatches are `HERMYS_DIRECTOR_PROMPT_SUFFIX` /
   `HERMYS_NARRATOR_PROMPT_SUFFIX` (env-only, never code).

## 3. Media + apps (rest of the week)

9. Implement the `spark` MediaService (faster-whisper large-v3-turbo,
   Kokoro + expressive tier, SDXL worker) behind the existing interface;
   the orchestrator/PWA from mac-week step 3 should run unmodified with
   `HERMYS_MEDIA=spark`.
10. Re-run the voice-loop demo (two phones + screen) at full fidelity;
    re-run `bench_turn.py` against the live orchestrator (latency
    regressions in the turn pipeline are bugs).
11. Ingestion LLM passes (mac-week step 4 scaffold) against the real stack;
    Prep Bench review of Episode 1's first beats.
12. Port launchd patterns to systemd units; start the overnight asset-prep
    batch (anchors, variants, the five LoRAs).
