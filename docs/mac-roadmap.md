# Mac roadmap — everything buildable before the Spark

The loop's worklist. Order matters; each item lands like everything before
it: gate tests green across all suites before every commit, push, watch CI
to conclusion, fix before proceeding. No local model serving on this
machine — LLM/STT/TTS/image work sits behind the existing seams
(`LlmClient`, `MediaService`, `HERMYS_*` env) with deterministic mock
implementations. HotDQ-derived content goes only to the private pack repo;
SRD + original code goes public. Schema changes need a `DECISION:` commit.

## Worklist (in order)

1. **Engine character model** — docs/charcreate-box-plan.md §A. SRD 5.2
   species/class/background data, standard-array + point-buy validation,
   `derive(build)` for all computed stats, events `character_created`,
   `backstory_recorded`, `portrait_attached`, `item_granted/used`,
   `level_up` validation. Gates: illegal builds throw; derive() golden
   tests; replay equality; a created character runs the skirmish.
2. **Interview backend** — §B. Hub `creator` role/phase, step machine
   (name → species/class/background → abilities → skills/gear →
   backstory → portrait → commit), parser behind `LlmClient` with the
   deterministic chip/keyword Mac implementation, rebind to `box` on
   commit. Gate: scripted interview transcript → legal character_created.
3. **Box tabs** — §D. Sheet/Gear/Magic/Journal tabs over the visibleTo
   fold; death-save pips; cast/use wired to engine commands; browser-
   verify via the orchestrator + relay like prior PWA work.
4. **Interview UI** — §B. Chips-first screens on the phone route; PTT
   reuses the existing capture; mock mode = typed text path.
5. **Portrait pipeline** — §C. Backstory → bible-format visual block
   (LLM seam + deterministic template fallback) → vision portrait
   assembly → MediaService render (mock: styled silhouette + saved
   prompt) → `portrait_attached` → phone + shared-screen reveal, one
   re-roll, host approval. Gate: end-to-end in mock with the prompt
   persisted.
6. **Mac demo gate** — scripted test: phone creates a character fully in
   mock mode, then fights a kobold; engine validated every step.
7. **Phase-4 extras** — pace micro-signal (▲/▼ message + host panel
   display), host approval queue (creation + portrait), reconnect/rebind
   any device to an existing character.
8. **Engine leftovers** — concentration (checks on damage, drop on fail),
   item use effects (potion heals via reported/engine dice), level_up
   choice validation.
9. **Prep Bench wiring** — orchestrator serves/saves pack drafts (host
   role only) so the Bench loads from the server instead of file inputs.
10. **Table State vector skeleton** — aggregate PTT telemetry + Box
    interaction counts + pace signals into a per-beat vector pushed to
    the host panel (room energy meter waits for hardware).
11. **Voice casting + SFX registry** (private pack repo) — troupe
    assignments per dialogue card's voice notes (voice_ref format), SFX
    tag list per beat's av_cues with synth/mixer notes.
12. **HotDQ render plan** (private pack repo) — entity cards from the
    visual bible via the vision planner → render-plan.json committed,
    ready for the Spark's overnight batch.

## Standing rules

- Suites: engine, brain, orchestrator, ingest, vision — all green before
  any commit; new mechanics get gate tests.
- Push every commit; watch the CI run for the pushed SHA to conclusion.
- Human/Spark items are out of scope: two-phone mkcert demo, Appendix B
  stat entry, live red-team, bench, real media.
- One coherent worklist item (or clean sub-slice) per loop iteration;
  summarize what landed, then continue.
- Stop the loop when the list is done or only human/Spark items remain.
