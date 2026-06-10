# Hermys Vision — visual fog-of-war by construction

Invariant 5: images render only from a **Visible Manifest** assembled from
revealed entity-card states. Module text never enters the image-prompt
path — there is structurally no way in.

```bash
npm test            # the gates — no GPU, no model
npm run plan        # pack drafts → render-plan.json for the Spark batch
```

Two halves:

- **`src/assemble.ts` — the live boundary.** Validates a manifest against
  `schemas/visible_manifest.schema.json`, then builds the prompt
  exclusively from each referenced card's *named, current,
  audience-revealed* state fragment + composition + the campaign style
  preset. Unknown card, non-current state, or unrevealed entity ⇒ hard
  `ManifestRejection`, no override. Partial knowledge never reaches the
  shared screen; private visions render per-Box.
- **`src/plan.ts` — the prep batch.** Enumerates every renderable card
  state into deterministic jobs (FNV-seeded, so re-planning never
  invalidates rendered assets): anchors for current states, **variants for
  every reveal transition** (the mill-quiet/mill-ablaze trick — reveals at
  the table are instant swaps, not renders). Recurring entities (3+ beats,
  or nominated) are stars: LoRA queue + P1. Output is pure data the Spark
  consumes overnight; it lives with the pack, gitignored.

`src/audit.ts` is the VLM seatbelt interface (improv renders only) — mock
now, Qwen3-VL on the Spark. `src/style.ts` holds the campaign style preset:
one visual hand across anchors, variants, and improv.
