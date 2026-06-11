# Hermys

A voice-driven AI Dungeon Master for an in-person D&D table. The system
narrates aloud, voice-acts NPCs, scores scenes, and renders consistent art to
a shared screen — while a deterministic 5e (2024 / SRD 5.2) rules engine keeps
every number correct underneath. Each player's phone becomes a "Box": a
character sheet, private window, dice pad, push-to-talk mic, and X-card.

Runs fully local on an NVIDIA DGX Spark. Developed on macOS; see
`docs/mac-week.md` for the hardware-independent build path and `CLAUDE.md`
for the operating rules of this repo.

## Status

| Phase | State |
|---|---|
| 0 — Spark benchmark gates | suite written (`bench/`), runs when hardware lands |
| 1 — deterministic engine | skeleton green: 5/5 exit tests (`engine/`) — breadth in progress |
| 2 — two-tier brain (Director/Narrator) | next, model-agnostic |
| 3–4 — voice loop, Boxes, shared screen | PWA shell this week |
| 5 — ingestion + Prep Bench | scaffold this week |
| 6 — Episode-1 vertical slice | Spark week |

## Quick start

```bash
cd engine && npm install
npm test          # the Phase 1 gate: determinism, replay, visibility, rewind
npm run demo      # watch a seeded skirmish — GM view vs. a player's Box view
```

## The invariants (short form — full list in CLAUDE.md)

The engine is the only source of truth for numbers. Nothing player-visible
exists except through visibility-tagged events. Every random draw is recorded
in its event — replay never re-rolls. The Narrator only ever sees a validated
brief; images render only from revealed-entity manifests. The engine is
product-clean SRD 5.2 (CC-BY-4.0); campaign packs are private and never
committed.

## Architecture in one breath

Director ("the Tally", sees everything, never speaks to players) → tool calls
into the deterministic engine + a Narration Brief → Narrator ("Pip", the only
voice players hear) → streaming TTS over a Web Audio mix on the shared screen,
while each phone shows exactly — and only — what that character knows.

---
*Rules content derives from the System Reference Document 5.2.1 by Wizards
of the Coast LLC, licensed under CC-BY-4.0 — full required notice and scope
in [ATTRIBUTION.md](ATTRIBUTION.md). Unofficial fan/engine work; not
affiliated with or endorsed by Wizards of the Coast.*
