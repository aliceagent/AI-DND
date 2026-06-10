# Hermys Engine — Phase 1 production (all gates passing)

The deterministic core from the build plan, runnable today:

```bash
npm install
npm test                               # every gate — the original five plus Phase 1 breadth
npx tsx --test test/skirmish.test.ts   # the original Phase 1 exit gate alone
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

## What production Phase 1 added (landed, gated)

- **Checks & saves with hidden DCs** per `schemas/event.schema.json`:
  `check_called` is public *without* the DC (modifier included — the Box
  roll pad pre-loads from it); a gm-visible companion commits the DC
  before any die is rolled (auditably un-fudgeable); `roll_reported`
  carries the player's dice; `check_resolved` lands twice — gm with the
  DC, public without. NPC/secret checks (`engineCheck`) and passive
  checks never touch a player view at all.
- **Conditions with mechanical effects** (prone, restrained, frightened,
  unconscious): effects are pure functions over state
  (`src/conditions.ts`) folded into the *effective advantage recorded on
  the event*, so replay never re-derives a rule. 2024 stacking: any adv +
  any dis cancel.
- **Death saves** (public table drama, reported rolls): three failures
  dead, three successes stable, nat 1 double, nat 20 up at 1 hp, damage
  while down is a failure (crit two, massive death).
- **2024 surprise**: initiative disadvantage recorded on
  `initiative_rolled`; nobody ever loses a round.
- **Spell slots + rests**: `castSpell` throws when the pool is dry (the
  engine, never the model, is the bookkeeper); slot events are visible
  only to the caster; long rests restore via the fold; short-rest hit
  dice heal from the player's reported roll.
- **SQLite** (`src/sqlite.ts`, better-sqlite3) behind the same
  `IEventStore` interface — byte-identical JSONL export, branch-aware,
  durable across reopen. JSONL import/export retained on both stores.
- **Snapshots keyed to event ids**: `state()` folds from the nearest
  snapshot on the active lineage; a rewind cutting earlier invalidates it
  naturally. Cache, not truth — never exported.

Still deliberately deferred: concentration, full SRD character builds
(class/species/background), inventory/goals — they ride in with Phase 2+
needs.

## File map

```
src/rng.ts         seeded RNG, dice exprs, adv/dis d20
src/store.ts       IEventStore + in-memory branch-aware store + visibility query
src/sqlite.ts      SQLite IEventStore (production), byte-identical JSONL
src/srd.ts         SRD 5.2 data layer: skills, modifiers, kobold + 4 PC archetypes
src/state.ts       pure fold: events -> GameState (snapshot-resumable)
src/conditions.ts  mechanical effects of conditions as pure state functions
src/engine.ts      command API: join/initiative/attacks/checks/saves/death saves/
                   conditions/slots/rests/reveal/rewind/snapshot
test/skirmish.test.ts   the original Phase 1 exit gate (untouched, green forever)
test/ambush.test.ts     the second scripted scenario: surprise, hidden DCs,
                        conditions, a PC down and saved, slots, long rest
test/*.test.ts          one gate file per mechanic
demo.ts            human-readable seeded skirmish, GM view vs player view
```

## Next (Phase 2 entry)

With this green, Phase 2 wraps the command API as LLM tools, builds the
context assembler that enforces the Narrator's revealed-only slice
(validating every Narration Brief against `narration_brief.schema.json`),
and ends with the red-team session: thirty adversarial minutes trying to
extract a planted secret through Pip. The store's `visibleTo` is already
the mechanism that makes that audit replayable.
