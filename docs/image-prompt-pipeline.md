# Image-prompt pipeline — full-story visual coverage via Opus subagents

Goal: a complete, reviewed library of **16:9 fullscreen image prompts** for
every scene, location state, and character in the campaign, authored in
advance so the Spark's SDXL batch renders the whole story overnight.
All generated prompt files land in **`packs/hotdq/` (gitignored)** — module-
derived content never enters version control; prompts are original
language per the `prompt_fragment` contract.

Sources: the D&D Encounters edition (episodes 1–3, in hand) and the full
adventure PDF (episodes 1–8, when provided). The pipeline is per-episode,
so the full book extends the same run.

## Mechanics

- Orchestrated with the Workflow tool; authoring agents run **Opus**.
- Agents don't parse the PDF themselves: a prep step extracts per-episode
  **text slices** (`pdftotext -layout`) and renders **page PNGs**
  (`pdftoppm`) into `packs/hotdq/source/` so agents can *see* official art
  and maps for grounding while writing original prompt language.
  (The Read tool can't rasterize PDFs in this session — poppler does.)

## Phases

**A. Inventory (3 agents, one per episode → JSON shot lists).**
Each agent reads its episode slice and emits every visual unit:
- locations with their *fiction-implied states* (before/after fire,
  hidden/sprung, occupied/cleared, day/night),
- named characters & creatures (with reveal aliases where identity is
  gated),
- key dramatic *moments* (the establishing beats, set pieces, climaxes),
each tagged `{ id, kind, states[], reveal_gate, source_page, beats[] }`.

**B. Visual bible (1 agent, consumes all inventories).**
Canonical visual descriptions for every *recurring* entity — face, build,
costume, palette, signature props — written once so every prompt that
features them repeats the same block verbatim. Identity drift across 100+
images is the failure mode this kills. Also locks the campaign style block
(cinematic language shared with `vision/src/style.ts`) and the 16:9
composition vocabulary (foreground anchor, lateral sweep, horizon
placement, negative space for UI).

**C. Prompt authoring (≈6 agents, episode-section batches).**
Input: shot-list slice + visual bible + prompt spec. Output per shot:
- one maximal-detail fullscreen prompt (subject → composition → lighting →
  palette → mood → style tags) + negative prompt, 16:9 explicit;
- variant prompts for every state on the shot's card;
- portrait + in-scene prompts for characters;
- `reveal_gate` carried through so the shared screen can't show a secret
  early (ties into `vision/` assembly at table time).
"As many as reasonable" ≈ establishing + action moment per encounter,
2 per named character, 1 per state variant — est. **90–130 prompts** for
episodes 1–3; roughly double with the full book.

**D. Verification (3 agents, adversarial).**
- *Coverage*: every inventory item has its prompts; nothing silently
  dropped.
- *Consistency*: recurring entities match the bible block exactly.
- *Hygiene*: no verbatim module sentences (paraphrase check); reveal
  gates present; 16:9 composition language present; no text/UI in image
  requests.
Findings loop back to the authoring agent for the affected batch.

**E. Assembly (1 agent + deterministic merge).**
- `packs/hotdq/image-prompts/e{1..3}.json` — machine-readable, card-shaped
  (feeds the `vision` planner / render-plan.json);
- `packs/hotdq/image-prompts/gallery.md` — human review list for the Prep
  Bench walk: one line per image with its prompt and gate.

## Order of execution

1. Prep: extract slices + render page PNGs (deterministic, no agents).
2. A (parallel ×3) → B (barrier: bible needs all inventories) →
   C (parallel, pipelined per batch) → D (pipelined per batch) → E.
3. On receipt of the full adventure PDF: re-run A for episodes 4–8 (and an
   E1–3 *delta* pass for detail the Encounters edition omits), reuse the
   bible (append new entities), then C/D/E for the new material.

## Boundaries

- Outputs are personal-use, local, gitignored. This doc describes process
  only.
- Prompts are original paraphrase — the verification pass enforces it.
- Stat blocks remain out of scope here entirely (separate human task).
