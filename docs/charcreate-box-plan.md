# Character creation + the full Box — build plan

The phone IS the player's character: push-to-talk voice, the living sheet
(stats, items, spells, conditions), private knowledge, and the rolls — all
of it a fold over `visibleTo(characterId)` events, never a second source of
truth (invariants 1–2). This plan covers: the SRD 5.2 character model in
the engine, the voice-first creation interview, the backstory → automatic
portrait pipeline, and the Box's full play surface.

Everything here is SRD 5.2 (CC-BY) + original code → public repo.

---

## A. Engine: the character model (the foundation, fully Mac-safe)

New `engine/src/character.ts` + chargen command surface. The engine — not
the model, not the UI — validates every choice's legality.

**Data (SRD 5.2):**
- Species, classes, backgrounds as data tables (the SRD subset we need for
  level 1–4: the four archetypes generalized to all SRD classes).
- Ability scores: standard array and point-buy, validated server-side.
- Derived, computed never stored: modifiers, AC (armor formulas), max HP,
  proficiency, save/skill bonuses, spell slots by class/level, passive
  scores. One pure function: `derive(build) → sheet`.

**Events (all visibility `[characterId]` unless noted):**
- `character_created` — the full build payload (the fold materializes the
  combatant from it; replaces hand-rolled `join()` for player characters).
- `backstory_recorded` — the player's spoken story, verbatim + a short
  Director summary; feeds canon and the portrait pipeline.
- `portrait_attached` — asset ref + the prompt that made it (public: the
  table sees faces).
- `item_granted` / `item_used` (already in the schema enum) — inventory is
  an event fold like everything else.
- `level_up` (already in enum) — choices validated like creation.

**Gates:** illegal builds throw (wrong array, unknown species, over-budget
point-buy); derive() golden tests against hand-checked sheets; replay
byte-equality stays green; a created character fights the existing
skirmish unchanged.

## B. The creation interview (voice-first, tap-fallback — Phase 5's
"voice interview" pulled forward)

A guided flow on the phone, one question per screen. Voice is the primary
input; **every step renders tap chips as the fallback** (and the only path
in mock media mode — which makes the whole flow Mac-testable end to end).

1. **Name** — PTT: "Call me Kael." → STT → confirm chip.
2. **Species → class → background** — PTT answer parsed by the utility
   LLM into a choice id; chips show the SRD options with one-line flavor.
3. **Abilities** — chips only (drag the standard array onto the six
   stats); voice can reorder ("put my best in dexterity").
4. **Skills + equipment** — class-legal choices as chips; voice picks.
5. **Backstory** — the long PTT moment: 30–60 seconds of "tell us who you
   are." Mock mode: a text area. Stored verbatim via `backstory_recorded`.
6. **The portrait-anchor moment** (build plan Phase 5): see §C — the
   reveal lands on the phone AND the shared screen: "this is you."
7. `character_created` commits; the Box flips from interview to sheet.

Parsing sits behind `LlmClient` (`HERMYS_LLM_*`): a deterministic
keyword/chip parser is the Mac/test implementation; the real model does it
on the Spark. The interview is a hub session phase: `join` as `creator`
role → interview messages → on commit the connection rebinds as `box` with
the new characterId (Box binds to the CHARACTER, per resolution §5.1).

## C. Backstory → automatic portrait (the new pipeline)

Voice story in, face out — assembled from existing parts:

1. `backstory_recorded` fires a charvis job: the LLM (Director route)
   distills the transcript into a **visual-bible block** — the same 40–80
   word canonical format the campaign bible uses (face, build, costume,
   bearing, palette, signature props). Stored on the character's entity
   card as `prompt_fragment`; deterministic fallback (species/class
   template + key adjectives) when no model is present.
2. `vision`'s portrait assembler (already built) wraps it: campaign style
   block + block + 16:9 portrait composition + negative prompt → a render
   request identical in shape to the campaign's 42 portrait prompts.
3. `MediaService.imageForManifest` renders it: **spark** = SDXL (seconds,
   live at the table); **mock** = stores the finished prompt + a styled
   silhouette placeholder so the flow demos on the Mac today.
4. `portrait_attached` (public) — the phone shows the face full-screen,
   the shared screen echoes it with the character's name: the table's
   "this is you" beat. Re-roll once free ("not quite — again"), then host
   approves. The portrait becomes the character's anchor asset for every
   future Visible Manifest (consistency with campaign art from day one).

## D. The Box at full Phase-4 depth

Tabs over one event fold (extending the existing `sheet` derived store):

- **Sheet** — portrait header, abilities + modifiers, AC/HP ring,
  conditions as chips, death-save pips when dying (the existing
  `roll_request` flow already covers death saves' reporting).
- **Gear** — inventory from `item_granted`/`item_used`; tap to use →
  engine command; encumbrance later.
- **Magic** — slot pips from the fold; cast = `castSpell` (engine throws
  if dry — UI just renders the refusal); prepared list from the build.
- **Journal** — what THIS character knows: `fact_revealed` to them,
  private reveals, canon, the per-character recap (`recapLines` exists).
- **Talk** — the existing PTT surface + floor queue + roll pad (built).
- **Pace micro-signal** — the ▲/▼ "offer Hermys a token" pair (one
  message type; feeds the Table State vector later).

Plus: reconnect/rebind by character (any phone logs into your character —
binding is to the soul, not the device), and the host panel gains a
creation-approval + portrait-approval queue.

## E. Order of work (each lands with gates, Mac-green)

1. **A. engine character model** — data + derive() + events + gates.
2. **B. interview backend** — hub `creator` phase + parser seam + tests
   (scripted interview transcript → legal `character_created`).
3. **D. Box tabs** — sheet/gear/magic/journal over the fold (browser-
   verified like the rest of the PWA).
4. **B-ui. interview screens** — chips-first; PTT wiring is already there.
5. **C. portrait pipeline** — charvis distiller (+deterministic fallback),
   vision portrait assembly, mock placeholder, `portrait_attached`,
   shared-screen reveal moment.
6. **Demo gate (Mac):** a phone creates a character end-to-end in mock
   mode — typed "voice", chips, backstory, placeholder portrait + saved
   prompt — then fights a kobold with the engine validating every step.
   **Spark day one adds:** real STT on the interview, real LLM parsing,
   SDXL portrait in seconds.

## Deferred (explicitly not this pass)

Mini-map/LocationGraph, Table State vector aggregation, host pacing dial,
level-up UI beyond the event, multiclassing, feats.
