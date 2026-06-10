# Handover — Hermes DM Project (for Claude Fable 5)

**To:** Claude Fable 5
**From:** the prior design session (Claude Opus 4.8)
**Attached:** this document + the campaign PDF, *Hoard of the Dragon Queen* (D&D
Encounters edition).
**Your job, in one line:** review everything below critically, improve it where it's
weak, and produce the **technical build plan** for how this game actually gets
built.

This briefing is self-contained — you don't need the earlier working documents to
act on it, though five exist (named in §2) and may be attached separately for depth.

---

## 1. The project

A voice-driven AI Dungeon Master for an **in-person** D&D table (4–6 players in one
room). The system narrates aloud, voice-acts every NPC, scores scenes with music
and sound effects, and renders consistent art to a shared screen — while a
deterministic rules engine keeps 5e correct underneath. Each player uses their own
phone as a combined character sheet, private window, dice-input, and push-to-talk
mic. The whole thing runs **locally on an NVIDIA DGX Spark** (GB10 Grace Blackwell,
128 GB unified memory). The owner already runs a local-first AI stack (LiteLLM
routing, local LLMs, agentic daemons), so "all local" is a hard preference, not a
nice-to-have.

The first campaign to support is the attached module. Treat the campaign as a
**removable data pack**, not something welded into the engine.

---

## 2. What's been produced so far

Five working documents (this handover consolidates their essence):
1. *Product decisions spec* — the ~20 locked decisions (§4 below).
2. *Build plan / mechanics (technical-leaning)* — runtime loop, mobile connection,
   character creation, persistence.
3. *Codex — Book of Powers* — the original fiction for the DM entity (§7).
4. *Hoard of the Dragon Queen ingestion plan* — how to run the attached module (§8).
5. *Product spec: mechanics of play* — the full played experience, turn by turn
   (§6).

You should feel free to **restructure or supersede** any of these. They are a
starting point, not scripture.

---

## 3. How to engage with this (important)

Please **do not simply validate** the work. The owner explicitly wants it reviewed
and improved. Interrogate the assumptions. Where a decision is weak, say so and
propose better. Where there's a gap, name it. The §9 "weak spots" list is where the
prior session has the least confidence — push hardest there. If you change a locked
decision, flag the change and the reasoning explicitly so the owner can accept or
reject it; don't silently drift.

---

## 4. Locked decisions (the baseline)

These were settled with the owner. Treat as the baseline; challenge with reasoning
if warranted.

1. **Audience:** undecided — personal table vs. eventual product. *(Still open; see
   §10.)*
2. **Players:** 4–6 humans, co-located in one room.
3. **Speaker identification:** push-to-talk, one device per player (sidesteps voice
   diarization entirely; gives clean turn boundaries).
4. **Display:** one shared screen for scene art/maps + each player's own device for
   private info.
5. **Generation latency:** pre-generate art for known scenes during prep; only
   improvise live when needed.
6. **Rules:** a **deterministic engine is the single source of truth** for all
   numbers; the LLM narrates over it and never tracks state itself.
7. **Dice:** hybrid — players roll physical dice and report; the agent rolls in
   secret for monsters and hidden checks.
8. **Visual consistency:** tiered — an anchor image for every entity, plus trained
   LoRAs for the few recurring stars.
9. **Music & SFX:** curated, mood-tagged loop library + triggered SFX library,
   ducked under narration (not generative).
10. **Voices:** fully voice-acted — a distinct *synthetic* voice per NPC (no cloning
    of real/celebrity voices), with a stored voice ID per NPC for cross-session
    consistency.
11. **Ruleset:** D&D 5e, **2024 revision**.
12. **Campaign use:** follow the published spine, but allow off-script detours
    (no railroading).
13. **Secrets / fog-of-war:** the module is split into revealed vs. hidden state;
    knowledge is partitioned **per character**, not just per party.
14. **Continuity:** full persistent world state + auto "previously on…" recaps.
    Persistence is **event-sourced** (append-only event log) so recaps, X-card
    rewind, and campaign memory all fall out of one mechanism.
15. **Infrastructure:** all local on the DGX Spark.
16. **Character creation:** a guided **voice interview with tap fallbacks** for
    crunchy choices; ends with a generated portrait that becomes the PC's anchor
    image; campaign backstory hooks wired in at creation.
17. **DM personality:** tone adapts **per campaign** via a tone profile that steers
    narration style, voice delivery, music selection, and art style together.
18. **Safety:** session-zero **lines & veils** + an in-session **X-card** (a button
    on every device).
19. **MVP target:** a **full vertical slice** — one complete mini-session that
    exercises every subsystem.
20. **The "Wizarding Box":** the player's phone is reframed as a diegetic magical
    artifact. It shows, live and scoped to that character: stats, inventory, money,
    spells, proficiencies, goals, the mission from their POV, relationships, a
    fogged mini-map of routes from their location, and a personalized lore feed. It
    also hosts push-to-talk (the phone is the player's mic) and the X-card. It gains
    **progressive unlocks** — new powers granted as in-fiction rewards, making the
    interface itself a reward surface.
21. **Cross-device visibility (resolved):** a player's sheet/state is **private by
    default**; the system never auto-broadcasts (not even combat HP). The player
    chooses what to share and when. This deliberately preserves roleplay
    information-asymmetry (bluffing about wounds, sitting on a find).

---

## 5. Architecture (conceptual)

- **Two-tier brain.** A **Director** (internally "the Tally") sees *everything* —
  the full module, world state, all secrets, lines/veils, tone — and decides what is
  revealed, to whom. It never addresses players. A **Narrator** ("Pip") is the only
  voice players hear; it receives **only the revealed slice** + current scene +
  tone, so it physically cannot leak a secret. This is the core safety boundary, and
  it maps onto the fiction (§7).
- **Game-State Engine.** Deterministic, authoritative. Holds characters, HP, slots,
  conditions, initiative, inventory, money, goals, relationships, quest log,
  discovered facts, a **location graph** (nodes + edges, for the mini-map and
  tactical maps), and world state. The LLMs read/write it through tools.
- **Asset pipeline.** Prep pass pre-renders anchor art for known locations/NPCs and
  trains LoRAs for recurring stars; live pass does reference-conditioned generation
  for improvised moments. **Secret-safe rendering:** only entities/areas the Director
  has marked revealed may be drawn — fog-of-war governs pixels, not just words.
- **Audio subsystem.** A real-time mixer: TTS narration on top, a mood-tagged music
  bed beneath (crossfaded by scene), triggered SFX — music and SFX ducked under
  speech.
- **The Boxes + shared screen.** Per-player browser PWAs on a live local connection,
  rendering a fogged, personalized view; one shared "table view" on the room TV.
- **Persistence.** Event-sourced campaign store, continuous save, all local.

---

## 6. Mechanics of play (the experience to preserve)

The technical spec must serve this experience, not reshape it for convenience:

- **Floor control (most important):** off-mic table talk is free and unheard;
  holding push-to-talk is the explicit "this is for the game" signal. Press-order
  forms a queue; each Box shows speaking/listening; Pip can spotlight a specific
  player by lighting their Box. This is what makes a voice DM work for a *group*.
- **Core loop:** Pip narrates → players discuss off-mic → one declares via PTT → the
  Tally decides if it's uncertain → if so Pip calls a check with a **hidden DC** →
  player rolls physical die and reports (Box knows modifiers) → engine resolves →
  Pip narrates, Box/screen/audio update.
- **Checks:** the Tally chooses the check; DCs hidden; **secret rolls** the agent
  makes invisibly so failure doesn't tip players off; passive checks automatic;
  advantage/modifiers applied by the engine but shown ("disadvantage: prone").
- **Combat:** initiative order on every Box + the screen; on your turn your Box
  shows your options; you declare in plain language; you roll physical d20s and
  report; engine resolves; **monster HP hidden** (descriptive states only); spells
  by voice or tap with slot validation; monsters acted by the Tally + agent rolls,
  voiced by Pip; positioning is theater-of-the-mind for skirmishes and a **tactical
  map** for set-pieces/dungeons.
- **Private reveals:** the Tally can surface something to **one** player's Box
  alone (the rogue spots the catch); that player chooses whether to tell the table.
- **Safety in play:** lines never appear; veils fade to black; the X-card halts and
  rewinds (event-sourcing makes "rewind" real).
- **Session lifecycle:** opens with an auto recap; closes at a natural beat with
  level-up (guided), downtime, continuous save, and a fresh recap generated for next
  time (which doubles as an exportable actual-play log).
- **Hard problem flagged:** pacing without faces. A human DM reads the room; Pip
  can't. Current answer is a Director "tension dial" + a host override. **This needs
  a better solution — see §9.**

---

## 7. The fiction (lightweight, optional to extend)

The DM is conceived as one god, **Hermys, the Keeper of the Game**, wearing two
faces that map exactly onto the architecture: **the Tally** (the all-knowing,
stoic, faceless keeper of rules and secrets = the Director) and **Pip** (the
playful, childlike, voice-of-everything = the Narrator). He is a god *of the game*,
not of the world. He's bound by four "chains" that encode the mechanics as
scripture: he cannot enter the world, he cannot choose for the players (player
agency), the Tally cannot lie or reveal what isn't earned (fog-of-war), and even he
bows to the dice (the hybrid-dice rule). The Box is "a shard of his regard," so
unlocks are the god granting favor. This is flavor scaffolding — keep, revise, or
ignore as serves the build.

---

## 8. The campaign (read the attached PDF)

*Hoard of the Dragon Queen* (D&D Encounters edition) is the first campaign. **Read
the PDF directly** for specifics. Key points for your planning:

- **Copyright posture:** this is Wizards of the Coast IP; the PDF grants personal
  printing only. The system must treat it as a **private, local, removable** pack —
  never redistribute its text, never expose it to other users, never reproduce WotC
  artwork. If the audience question (§10) ever becomes "product," this module cannot
  ship and would be swapped for original/licensed content. **Do not reproduce
  substantial copyrighted text in your output** either — reference structure and
  names in your own words.
- **Why it's a good test:** its three episodes are three different play modes —
  Episode 1 is an open mission-based sandbox over a timed night siege; Episode 2 is
  linear travel + social infiltration with a capture branch; Episode 3 is a keyed
  dungeon crawl with traps and a boss. Building for it forces the whole engine into
  shape.
- **Ingestion:** parse into a beat graph per episode, a location graph, an NPC
  roster (→ portrait anchors + voice IDs), the Appendix B stat blocks (→ engine
  records, **human-verified**), and a **reveal layer** splitting boxed read-aloud
  text (Narrator-speakable) from DM-only secrets. This module is unusually
  **secret-dense**, so fog-of-war is heavily stressed — including in images (don't
  render the loft ambushers or the hidden egg) and audio.
- **A built-in showcase:** the temple-siege scene has a door-HP "tension clock" in
  the text — each battering-ram beat can be one SFX + one on-screen HP tick + one
  notch of musical escalation, all firing together. Good demo material.
- **Recommended first slice:** the opening of Episode 1 (the approach → the dragon
  over the keep → "Seek the Keep" combat → meeting the NPCs at the keep), with the
  win condition being *no secret leaks in text, audio, or image*.

---

## 9. Weak spots — where to push hardest

The prior session has the **least** confidence here. These are the real risks:

1. **Pacing without faces.** The tension-dial + host-override answer is thin. A
   human DM's biggest tool is reading the table. Propose something better.
2. **Secret leakage through generated images.** Text fog-of-war is conceptually
   solved; *visual* fog-of-war (not drawing the ambush, the hidden door, the
   unrevealed NPC) is harder and underspecified.
3. **DGX concurrent live load.** LLM(s) + Whisper STT + a warm neural TTS daemon +
   occasional image generation, all at once, on one box, in real time. Nobody has
   benchmarked this. It may force model-size, quantization, or hybrid-cloud
   compromises. Stress-test it early in your plan.
4. **Campaign auto-parsing fidelity.** Real modules are messy. How automated can
   ingestion be vs. human-in-the-loop? Stat-block correctness is the foundation
   everything narrates over.
5. **Latency on improvised images.** Pre-gen covers known beats; live generation for
   off-script moments is the one place latency bites. Needs a graceful "Pip keeps
   talking" fallback.
6. **Real-time audio mixing.** Ducking + crossfade + multi-voice TTS is real
   engineering, not a library call.
7. **Local multi-voice TTS quality.** Many distinct characterful NPC voices on-box
   is the component most likely to feel below cloud quality. Where's the line?

---

## 10. Open decisions

- **Box upgrade binding (the last truly open one):** do unlocks attach to the
  *character* (level/quest rewards) or to the *device* (the Box levels independently,
  so a lent/stolen Box carries its powers)? Flavor and mechanics differ.
- **Audience:** personal vs. product (gates copyright posture and polish).
- **MVP map scope:** does the first slice need tactical maps, or theater-of-mind
  only?
- **Import automation level:** fully human-curated vs. LLM-parse-then-review.

---

## 11. Your deliverable

Produce a **technical build plan** that an engineer could start from. It should:

1. **Critique** the design above — assumptions, gaps, risks — and propose
   improvements (flagging any changed decisions).
2. **Specify the technical architecture** in implementation terms: component/service
   design, data models (character, world state, the event log, the reveal layer, the
   location graph, the asset/voice registries), and how the Director/Narrator/Engine
   actually interoperate (interfaces, who calls whom).
3. **Choose the stack**, honoring the all-local DGX constraint — models (LLM
   routing, STT, TTS, image, LoRA training), storage, the realtime layer, the PWA,
   and process management — with rationale and the concurrency/quantization
   trade-offs from §9.3.
4. **Detail the campaign-ingestion pipeline** concretely, applied to the attached
   module, including the human-in-the-loop step and the reveal-tagging schema.
5. **Sequence the build** into phases/milestones, each independently demoable,
   culminating in the Episode-1-opening vertical slice (§8), and address the §9 weak
   spots head-on within the plan.
6. **Resolve or frame** the §10 open decisions with recommendations.

Honor these constraints: all-local on the DGX; 5e 2024; the personal-use copyright
posture; and the played experience in §6 as the thing the build must serve. The
locked decisions in §4 are the baseline — improve on them with explicit reasoning,
don't drift from them silently.
