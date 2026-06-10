# Hermys Engine — Phase 1 skeleton (exit tests passing)

The deterministic core from the build plan, runnable today:

```bash
npm install
npx tsx --test test/skirmish.test.ts   # the Phase 1 exit gate — 5/5 passing
npx tsx demo.ts 1234 5678              # watch a seeded skirmish; GM view vs a player Box view
```

## What this skeleton proves (the four invariants)

1. **Determinism by construction.** Every random draw is recorded *in* the
   event payload at the moment of drawing (`src/rng.ts`, `engine_rolled`
   events). State is a pure fold over the timeline (`src/state.ts`), so the
   same seeds produce byte-identical logs and replaying a serialized log
   reproduces final state exactly. Test: `determinism`, `replay`.

2. **Hybrid dice (decision 7).** PC attacks take *reported* d20 + damage rolls
   (`pcAttack`); NPC attacks draw from the engine RNG and record gm-visible
   (`npcAttack`). The two paths converge in one resolver.

3. **Visibility as the only reality (decisions 13/21).** Every event carries
   `public | gm | [characterIds]`. Monster HP, NPC initiative, and NPC stat
   numbers are gm-visible; players get descriptive `health_tier_changed`
   events ("bloodied", "staggering") instead. `store.visibleTo(charId)` is the
   single query that the Box feed, recaps, and fog-of-war all share.
   Test: `visibility`.

4. **Rewind = rebranch (decisions 14/18).** `rewindTo(eventId, branchId)`
   opens a new branch cut at the event; folds follow the active lineage;
   the abandoned branch stays in the raw log for audit. Test: `rewind`.

## What production Phase 1 adds (shapes are final, breadth is not)

- **Rules breadth:** the SRD 5.2 core beyond attack/damage — checks & saves
  with hidden DCs (the `check_called` / `check_resolved` events from
  `schemas/event.schema.json`), conditions with mechanical effects
  (prone ⇒ melee advantage, etc.), death saves, spell slots, rests,
  concentration. The 2024 surprise rule (initiative disadvantage, not a
  lost round) lands here.
- **Storage:** swap the in-memory store for SQLite (same `EventStore`
  interface; JSONL import/export kept for portability and the leak-audit
  replay).
- **Snapshots:** periodic state snapshots keyed to event ids so long
  campaigns fold from the nearest snapshot, not from event 1.
- **Character model:** full SRD 5.2 build (class/species/background),
  derived stats computed not stored, inventory/slots/goals per the
  build-plan data model.
- **Tool surface:** the typed command API here becomes the LLM tool schema
  the Director calls in Phase 2 (`resolve_check`, `apply_damage`,
  `advance_initiative`, `reveal_fact`, `set_scene`, `query_state`).

## File map

```
src/rng.ts      seeded RNG, dice exprs, adv/dis d20
src/store.ts    branch-aware append-only event store + visibility query
src/srd.ts      SRD 5.2 data layer (kobold + 4 PC archetypes for the gate test)
src/state.ts    pure fold: events -> GameState
src/engine.ts   command API: join/initiative/attacks/damage/reveal/rewind
test/skirmish.test.ts   the Phase 1 exit gate
demo.ts         human-readable seeded skirmish, GM view vs player view
```

## Next (Phase 2 entry)

With this green, Phase 2 wraps the command API as LLM tools, builds the
context assembler that enforces the Narrator's revealed-only slice
(validating every Narration Brief against `narration_brief.schema.json`),
and ends with the red-team session: thirty adversarial minutes trying to
extract a planted secret through Pip. The store's `visibleTo` is already
the mechanism that makes that audit replayable.
