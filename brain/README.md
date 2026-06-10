# Hermys Brain — Phase 2: the two-tier brain, text only

Director (Tally) and Narrator (Pip) as two prompt/route configurations over
ONE model endpoint (build plan §1.3). The safety boundary is the **context
assembler**, not model separation: the Narrator call simply never has hidden
state in its context window.

```bash
npm install          # (engine/ must be npm-installed too)
npm test             # the Phase 2 gates — no model required (MockLlm)
npm run hotseat      # text-mode session: type declarations, type rolls
npm run redteam      # the exit gate: adversarial battery → docs/redteam-phase2.md
```

`hotseat` and `redteam` need a live model and therefore run on the **Spark**
(owner decision: no local model serving on the MacBook — see
`docs/mac-notes.md` and `docs/spark-day-one.md`). Everything else, including
all gate tests, runs anywhere.

Model endpoint is config, never code (the Spark swap is two env vars):

```bash
export HERMYS_LLM_BASE_URL=http://localhost:11434/v1   # any OpenAI-compatible server
export HERMYS_LLM_MODEL=qwen3:4b
```

## The safety boundary (invariant 4)

`src/context.ts` is the only path to a Narrator call:

- **Director context** = everything: full state, gm timeline, the whole pack
  including gm-only facts. Tally sees all, says nothing to players.
- **Narrator context** = an **ajv-validated Narration Brief**
  (`schemas/narration_brief.schema.json`) + the revealed transcript (a
  visibility-filtered fold — the same source recaps use). Validation is a
  hard gate with no override parameter:
  - any **gm-scoped fact id anywhere** in the brief → `BriefRejection`;
  - any **`dc` key at any depth** → `BriefRejection` (DCs are structurally
    absent from briefs);
  - every `fact_ref` must be revealed **to the party** (a single-character
    Box reveal is still not narration-safe);
  - schema violations → `BriefRejection`.
  The Director gets the rejection reasons back exactly once; a second leaky
  brief fails the turn loudly. `narrate()` re-validates (defense in depth).

## File map

```
src/llm.ts        OpenAI-compatible client (fetch) + MockLlm for the gates
src/tools.ts      engine command API as an OpenAI tool schema + dispatcher
src/context.ts    THE safety boundary: Director/Narrator context assembly
src/director.ts   the Tally loop: tools until send_narration_brief
src/narrator.ts   the Pip route: validated brief + transcript → prose
src/canon.ts      canon-capture: Pip inventions ratified or corrected
src/recap.ts      recap = filtered fold over visibleTo
src/scene.ts      hand-authored mini-scene (original content; planted secret)
src/session.ts    one full text turn, shared by hotseat + red team
src/hotseat.ts    CLI session runner
src/redteam.ts    the exit gate: adversarial battery → docs/redteam-phase2.md
```
