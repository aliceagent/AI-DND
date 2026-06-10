# Mac Week — progress plan without the Spark

The Spark Founders box arrives next week. Until then, development runs on a
MacBook Pro (Apple Silicon). The build-plan phase *order* assumed hardware
first; this week inverts it: everything hardware-independent gets built now, so
the Spark's first day is benchmarking and endpoint-swapping, not scaffolding.

## The one rule that makes this work

**Nothing in shared code may assume CUDA, the Spark, or any specific model.**
- Model endpoints are config: `HERMYS_LLM_BASE_URL`, `HERMYS_LLM_MODEL`. On the
  Mac that points at the existing local stack (Ollama / LM Studio / LiteLLM
  with `gpt-oss:20b` or similar); on the Spark it becomes llama-server with
  GPT-OSS-120B. Zero code changes at swap time.
- STT/TTS/image live behind a `MediaService` interface with three
  implementations: `mock` (instant canned outputs, used by tests), `mac`
  (whisper.cpp + Kokoro run fine on Apple Silicon; image = stub or anchor
  placeholders), `spark` (the real Part-4 stack, written next week).

## What gets built this week (in order)

### 1. Repo + CI green (hour one)
Push to GitHub; the three CI jobs (engine tests, schema validation, the
pack-boundary check) are the hardware-independent quality gate from day one.

### 2. Engine breadth — finish Phase 1 production (biggest block, fully Mac-safe)
- Checks & saves with the hidden-DC event flow (`check_called` public without
  DC → `roll_reported` → `check_resolved` with `dc_visibility: gm`).
- Conditions with mechanical effects (prone, restrained, frightened — enough
  for Episode 1), death saves, the 2024 surprise rule (initiative
  disadvantage), spell slots + rests, passive checks.
- SQLite behind the existing `EventStore` interface (better-sqlite3; keep the
  JSONL import/export for portability and the leak-audit replay).
- Snapshots keyed to event ids so long campaigns fold from the nearest
  snapshot.
- Exit: the skirmish gate stays green; new gates for each mechanic; a second
  scripted scenario exercising checks/saves/conditions end-to-end.

### 3. Phase 2 — the two-tier brain, text only (works against ANY local model)
- Engine command API wrapped as an OpenAI tool schema for the Director.
- The **context assembler** — the safety boundary: builds Director context
  (everything) and Narrator context (validated Narration Brief + revealed
  transcript only). Briefs validated with ajv against
  `schemas/narration_brief.schema.json`; any gm-scoped fact id in a brief is a
  hard rejection with a test asserting it.
- Canon-capture: post-hoc extraction of Pip's invented assertions →
  `canon_ratified` events or correction notes.
- Recap generator as a filtered fold over `visibleTo`.
- Text-mode CLI session runner ("hotseat" mode: type declarations, type rolls).
- Exit: a full text session on the Mac model, **plus the red-team session** —
  30 adversarial minutes trying to extract a planted secret through Pip. The
  smaller Mac model is actually a *harder* leak test (weaker instruction
  following), so passing here is a strong signal for the Spark.

### 4. Orchestrator + PWA shell (phones work on home WiFi today)
- WebSocket hub; session/join flow; role gating (box / screen / host).
- **PTT on the phone**: mic capture needs HTTPS — use `mkcert` for a local CA
  trusted on the phones; this exact setup carries to the Spark.
- Box skeleton: sheet view fed by `visibleTo`, the roll pad (appears on
  `check_called`, pre-loaded with modifier), private-reveal toast, X-card
  button wired to rewind.
- Shared-screen client with the **Web Audio mixer** — music bed, ducking,
  SFX bus. Test with library MP3s and Mac-Kokoro narration; the mixer code is
  identical on the Spark.
- Exit: two phones + the MacBook screen run a low-fidelity voice loop
  end-to-end (mac MediaService), floor-control queue visibly working.

### 5. Ingestion scaffold + Prep Bench skeleton (uses the Mac LLM stack)
- Parser passes producing draft beats/entity-cards into `packs/hotdq/`
  (gitignored), validated against the schemas.
- Prep Bench as the host-role PWA view: beat list, fact/reveal-tag editor,
  source-page reference, approve toggle.
- Hand-verify the Appendix B stat blocks into engine records this week —
  it's an hour of human work and it unblocks everything.
- Exit: Episode 1's beat graph drafted and at least the first three beats
  human-approved.

## What waits for the Spark (and is ready to run on day one)

| Item | Why it waits | Day-one action |
|---|---|---|
| `bench/` suite (the Phase 0 gates) | needs GB10 numbers | copy config, run, `report.py` → GO/NO-GO |
| GPT-OSS-120B routes | won't fit/serve well on the Mac | flip two env vars |
| SDXL throughput + LoRA training | CUDA pipeline | start the prep batch overnight |
| Expressive-TTS audition for star NPCs | quality call needs the real box | A/B vs Kokoro+style |
| systemd units | Linux | port the launchd patterns |
| Latency sign-off on the full turn | the real numbers | re-run `bench_turn.py` against the live Orchestrator |

If the Mac week lands items 1–5, the Spark week is: benchmark, swap endpoints,
re-run the red-team at full model strength, then go straight at the Phase 5/6
asset prep and the vertical slice.
