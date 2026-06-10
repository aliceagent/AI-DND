# Mac notes — platform workarounds and deferrals

Per the working agreement: when a dependency fights Apple Silicon (or the
no-local-models rule), note it here and move on.

## Decision: no local LLM serving on the MacBook (2026-06-10, owner)

The owner directed that no local model servers run on this MacBook at all —
the DGX Spark (arriving ~next week) does all model serving and benchmarking.
Consequences for mac-week scope:

- **Phase 2 live gates moved to Spark day one:** the hotseat session against
  a real model and the 30-minute red-team (`brain/npm run redteam` →
  `docs/redteam-phase2.md`) run on the Spark. The harness is complete and
  tested against `MockLlm`; on the Spark it needs only the two env vars.
- **Phase 3 voice loop uses the `mock` MediaService** on the Mac (the plan's
  sanctioned fallback). whisper.cpp/Kokoro are NOT installed here.
- **Ingestion LLM passes** (Phase 5 scaffold) are stubbed behind the same
  `LlmClient` interface; deterministic fixtures on the Mac, real passes on
  the Spark.

See `docs/spark-day-one.md` for the ordered handoff runbook.

## Homebrew ollama is broken on macOS (for the record)

Observed before the no-local-models decision, kept for posterity since it
cost an hour: `brew install ollama` (0.30.7 bottle) ships only the
experimental MLX runner — `lib/ollama/` contains `mlx_metal_v3` but **no
`llama-server`**, so every GGUF generation request fails with
`llama-server binary not found`. The official release tarball
(`ollama-darwin.tgz` from GitHub releases) bundles `llama-server` and works.
Everything was uninstalled afterward; if anyone ever needs ollama on a Mac,
use the official tarball or Ollama.app, not brew.
