# Kickoff prompt for Claude Code

Paste everything below the line into Claude Code, launched from the repo root.

---

You are taking over implementation of **Hermys**, a voice-driven AI Dungeon
Master. This repo was scaffolded by design sessions that produced a build plan,
contract schemas, a Spark benchmark suite, and a passing engine skeleton. Your
job is to extend it — not redesign it.

**First, read in this order:**
1. `CLAUDE.md` — invariants, environments, working agreements. Binding.
2. `docs/hermys-dm-technical-build-plan.md` — the architecture authority.
3. `docs/mac-week.md` — this week's scope and ordering. Follow it.
4. `engine/README.md` and skim `engine/src/` + `engine/test/` — the patterns
   you must continue (events carry their rolls; state is a pure fold;
   visibility on every event).
5. `schemas/*.json` — contracts. Do not modify without flagging
   `DECISION:` in the commit and explaining the migration.

**Environment right now:** MacBook Pro (Apple Silicon), no CUDA. The DGX Spark
arrives next week. Nothing you write in shared code may assume the Spark —
model endpoints via `HERMYS_LLM_BASE_URL` / `HERMYS_LLM_MODEL`, media behind
the `MediaService` interface (`mock` / `mac` / `spark`). The `bench/` suite is
Spark-only; leave it alone.

**Verify before building:** `cd engine && npm install && npm test` — five
tests must pass. If they don't, stop and fix that first.

**This week's work, in order (details in docs/mac-week.md):**

1. **Engine breadth (Phase 1 production).** Checks/saves with the hidden-DC
   event flow per `schemas/event.schema.json`; conditions with mechanical
   effects (prone, restrained, frightened); death saves; the 2024 surprise
   rule (initiative disadvantage, never a lost round); spell slots + rests;
   passive checks; SQLite behind the existing `EventStore` interface (keep
   JSONL import/export); snapshots keyed to event ids. Every mechanic lands
   with a gate test; the existing five stay green forever.
2. **Phase 2 — two-tier brain, text only.** Wrap the engine command API as an
   OpenAI tool schema. Build the **context assembler** — the safety boundary:
   Director context gets everything; Narrator context gets ONLY an
   ajv-validated Narration Brief + revealed transcript. A gm-scoped fact id in
   a brief is a hard rejection, with a test asserting it. Add canon-capture
   for Narrator inventions and the recap generator (a filtered fold over
   `visibleTo`). Ship a hotseat CLI session runner. Test against the local
   Mac model. End with a red-team transcript: 30 minutes adversarially trying
   to extract a planted secret through the Narrator — zero leaks is the gate.
3. **Orchestrator + PWA shell** in `apps/`: WebSocket hub, join/role flow
   (box / screen / host), phone PTT (HTTPS via mkcert), Box skeleton fed by
   `visibleTo`, roll pad on `check_called`, X-card → rewind, and the
   shared-screen client with the Web Audio mixer (music bed + ducking + SFX).
   Demo: two phones + the laptop screen run a low-fidelity voice loop with
   the `mac` MediaService (whisper.cpp + Kokoro) or `mock` if those fight
   the platform.
4. **Ingestion scaffold + Prep Bench skeleton**, writing drafts into
   `packs/hotdq/` (gitignored). Never paste module text into code, tests, or
   commits — paraphrase. Stat blocks are entered by the human owner, not
   parsed blind.

**Working agreements (enforced by CI):** engine tests green before every
commit; schemas validate; nothing under `packs/` except its README is ever
committed; no direct pack imports in engine code. Decision changes get a
`DECISION:` commit prefix. When a dependency fights Apple Silicon, note the
workaround in `docs/mac-notes.md` and move on — don't burn hours on a
component the Spark will replace.

Start with step 1. After each numbered step, stop and summarize what changed,
what's tested, and anything you'd flag for design review before continuing.
