# CLAUDE.md — Hermys DM

AI Dungeon Master for an in-person D&D table (4–6 players, one room). Voice-driven,
fully local on an NVIDIA DGX Spark (GB10, 128 GB unified memory, aarch64). Players'
phones are PWAs ("Boxes": character sheet + push-to-talk mic + private reveals);
one shared TV screen carries art and the audio mix.

**Read `docs/hermys-dm-technical-build-plan.md` before any architectural work.**
It is the authority. This file is the operational digest.

## Repo layout

```
docs/          build plan, original handover, mac-week plan — design source of truth
schemas/       JSON Schemas: entity_card, narration_brief, visible_manifest,
               event, beat — these are CONTRACTS; change only with explicit approval
bench/         Phase 0 benchmark suite (runs ONLY on the Spark; gates in bench/README.md)
engine/        TypeScript deterministic rules engine (Phase 1) — tests are the gate
apps/          Orchestrator + PWA (Box / shared screen / host / Prep Bench) — Phase 3+
packs/         campaign packs. PRIVATE. gitignored except packs/README.md.
               Engine code touches packs only through the pack-loader interface.
```

## Environments (read this before writing any platform-specific code)

- **Dev (now):** MacBook Pro, Apple Silicon. No CUDA. Local models via the
  owner's existing stack (Ollama / LM Studio / LiteLLM).
- **Target (next week):** DGX Spark, Linux aarch64, GB10 CUDA, 128 GB unified.
- Therefore: model endpoints come from env (`HERMYS_LLM_BASE_URL`,
  `HERMYS_LLM_MODEL`); STT/TTS/image live behind a `MediaService` interface
  with `mock` / `mac` / `spark` implementations; nothing in shared code may
  assume CUDA or a specific model. The Spark swap must be config-only.
- The bench suite and anything depending on its latency gates waits for the
  Spark. This week's scope is `docs/mac-week.md` — follow it in order.

## Non-negotiable invariants (do not weaken these to make a test pass)

1. **The engine is the single source of truth for all numbers.** LLMs never track
   state; they read/write through engine tools only.
2. **Nothing player-visible exists except through visibility-tagged events**
   (`public | gm | [characterIds]`). Fog-of-war, recaps, Box feeds, and the leak
   audit are all filters over one event stream. No side channels.
3. **Determinism by construction:** every random draw is recorded inside its event
   at draw time. Replay folds events; it never re-rolls. The byte-identical-log
   test must stay green forever.
4. **The Narrator (Pip) only ever receives a validated Narration Brief**
   (schemas/narration_brief.schema.json) + revealed transcript + tone. The context
   assembler is the safety boundary — never pass module text or gm-visibility
   facts into a Narrator call. DCs are structurally absent from briefs.
5. **Images render only from a Visible Manifest** assembled from revealed
   entity-card states. Module text never enters the image-prompt path.
6. **Hybrid dice:** PC rolls are reported by players; NPC/secret rolls are drawn
   from the seeded engine RNG and recorded gm-visible.
7. **Monster HP is never public.** Players get descriptive tiers
   (unhurt/scratched/bloodied/staggering/down) via `health_tier_changed`.
8. **Rewind = rebranch.** X-card opens a new branch cut at an event id; old
   branches are retained, excluded from folds and recaps.
9. **Engine/pack boundary = legal boundary.** Engine uses SRD 5.2 (CC-BY-4.0,
   covers 2024 rules — keep the attribution file). The HotDQ pack is personal-use
   WotC IP: never committed to the engine repo, never reproduced in output, never
   served beyond the local table.

## Architecture (one paragraph)

Two LLM personas over ONE resident model (GPT-OSS-120B via LiteLLM routes — the
Spark's 273 GB/s bandwidth forbids two big residents): the **Director ("Tally")**
sees everything, emits tool calls + Narration Briefs, never addresses players;
the **Narrator ("Pip")** is the only voice players hear. Deterministic engine
underneath; Orchestrator (WebSocket hub) sequences STT → Director → Engine →
Narrator → TTS and schedules GPU work (P0 interactive always wins; improv images
run only inside narration-playback windows; prep jobs never run live).

## Stack (locked unless a bench fails)

llama.cpp + LiteLLM (GPT-OSS-120B MXFP4; Qwen3-4B utility) · faster-whisper
large-v3-turbo (PTT clips, no streaming ASR) · Kokoro TTS workhorse + one
expressive model for the ~5 star NPCs (voice TROUPE of 8–12, radio-drama casting)
· SDXL + per-entity LoRAs, SDXL-Turbo for improv · SvelteKit PWA (Box/screen/
host/Prep-Bench are role-gated views of one app) · Web Audio mixing ON THE
SHARED-SCREEN CLIENT (ducking/crossfade/SFX — do not build a server-side mixer)
· SQLite + content-addressed assets · systemd.

## Build phases & gates (each must be demoable before the next starts)

0. Bench (DONE when RESULTS.md says GO): turn p95 first-syllable ≤ 4.0 s;
   transcript ≤ 0.7 s; Director first token ≤ 2.0 s; image-gen LLM degradation
   ≤ 30 %; warm TTFT ≤ 25 % of cold; residency ≤ 100 GB. Fallback ladder if not:
   (a) Director low effort in-turn + anticipatory planning between turns,
   (b) Narrator on Qwen3-30B-A3B, (c) cloud spillover ONLY with owner sign-off.
1. Engine core (skeleton DONE, 5/5 gate tests passing): extend breadth —
   checks/saves with hidden-DC event flow, conditions with mechanical effects,
   death saves, slots/rests, 2024 surprise rule (initiative disadvantage, NOT a
   lost round), SQLite behind the existing EventStore interface, snapshots.
2. Two-tier brain, text only. Gate: full text session + 30-min adversarial
   red-team fails to extract a planted secret through Pip. Zero leaks.
3. Voice loop: PTT PWA, STT, streaming TTS, screen mixer. Gate: 4 phones + TV
   play a scene by voice; floor control feels right with real interruptions.
   Floor modes: exploration = press-order queue; combat = initiative owns floor.
4. Boxes in full: sheet, slots, roll pad, private reveals, mini-map, X-card,
   pace micro-signal, Table State vector (PTT telemetry + Box interaction
   patterns + room LOUDNESS-ONLY energy meter — never transcribe room audio).
5. Content pipeline: ingestion + Prep Bench (human approval mandatory; stat
   blocks verified line-by-line), asset prep, voice casting.
6. Vertical slice: HotDQ Episode 1 opening, 4 real players, 2 sessions.
   Win condition: NO secret leaks in text, audio, or image — verified by
   replaying the event log against the pack's hidden layer.

## Working agreements

- Tests are gates, not decoration. `engine/`: `npm test` green before any commit.
- Do not modify `schemas/*.json` without flagging it as a contract change and
  explaining the migration.
- Latency regressions in the turn pipeline are bugs; re-run `bench_turn.py`
  after touching anything in the hot path.
- When module content is needed in code or tests, paraphrase; never paste pack
  text outside `packs/`.
- Decision changes vs. `docs/hermys-dm-technical-build-plan.md` must be flagged
  explicitly in the commit message (`DECISION:` prefix), never drifted silently.
- aarch64 reality: prefer wheels known to ship aarch64+CUDA; if a dependency
  fights the platform, note the workaround in `docs/spark-notes.md`.

## Open items deliberately deferred

- Tactical maps (Phase 7 / Episode 3 — do not build early; the slice wins on
  voice, fog, and feel).
- Expressive-TTS model choice for star NPCs (bench on-box; Kokoro+style is the
  acceptable fallback).
- Product path: engine stays product-clean (SRD 5.2 + attribution); the HotDQ
  pack can never ship. Original packs authored via the Prep Bench are the
  long-term content answer.
