# Hermys DM — Technical Build Plan

**From:** Claude Fable 5 (responding to the Opus 4.8 handover)
**Scope:** critique, architecture, stack, ingestion pipeline, build sequence, open-decision resolutions.
**Hard constraints honored:** all-local on the DGX Spark; 5e 2024; personal-use copyright posture for the module; the §6 played experience is the thing being served.

---

## Part 1 — Critique of the prior design

The core decisions are sound. The two-tier brain, event sourcing, push-to-talk floor control, and the deterministic engine as single source of truth are all correct and I am not changing them. The following are the places where the design is weak, wrong, or under-specified, with proposed fixes. Changed decisions are flagged **[CHANGE]**; refinements that keep the decision but alter how it's met are flagged **[REFINE]**.

### 1.1 The licensing gift the prior plan missed

The handover treats the entire 5e ruleset as if it carries the module's copyright posture. It doesn't. Wizards released **SRD 5.2 under Creative Commons CC-BY-4.0 (April 2025)**, and SRD 5.2 covers the **2024 revision** — classes, the core resolution mechanics, conditions, most monsters, spells. This means:

- The **rules engine can be built on SRD 5.2 content and is product-safe forever**, with attribution.
- Only the **campaign pack** (HotDQ text, its named NPCs, its art) is personal-use-only.
- The engine/pack boundary the handover already demanded is therefore not just architecture hygiene — it is the exact line between "shippable" and "private." Enforce it at the repo level: the engine repo contains zero module text; packs live in a separate directory that is gitignored or in a private repo.

This partially resolves the §10 audience question: build the engine as if it will be a product, keep the pack private, and the decision never has to be made early.

### 1.2 "Physically cannot leak" is overstated **[REFINE — decision 13]**

The Narrator receiving only the revealed slice prevents *leakage of module secrets*, but two failure modes remain:

1. **Coincidental invention.** Pip, asked to improvise, can invent "a hidden door behind the altar" that happens to exist in the module. Players can't distinguish a lucky hallucination from a leak, and worse, the Tally now has a canon conflict.
2. **Foreshadowing starvation.** A Narrator that knows literally nothing hidden also cannot foreshadow, and foreshadowing is half of good DMing.

**Fix:** the Director→Narrator interface is not "revealed facts" but a structured **Narration Brief** per beat: scene facts (revealed), sensory palette, *sanctioned hints* (Director-authored foreshadow lines, pre-laundered), *negative constraints* ("do not describe the loft interior," "do not name any creature in this room"), tone, and a spotlight directive. The Narrator improvises *within* the brief. The Director also runs a post-hoc check: any concrete world assertion Pip invents is either ratified into canon (written to the event log as a fact) or flagged for correction. Invention isn't prevented — it's *captured*.

### 1.3 Two LLM personas ≠ two resident models **[REFINE — architecture]**

The handover implies Director and Narrator are separate models. On a 273 GB/s box, every resident model competes for the same bandwidth. The correct framing: **Director and Narrator are two prompt/route configurations over one resident MoE model** (GPT-OSS-120B, already the owner's default), with a small fast utility model for classification-grade tasks. The safety boundary lives in the **context assembler**, not in model separation — the Narrator call simply never has hidden state in its context window. This is just as airtight and halves the memory/bandwidth bill. Detail in Part 4.

### 1.4 Pacing without faces — a real answer **[NEW — addresses weak spot 9.1]**

The tension dial + host override is a control surface with no sensor attached. But the system already has rich sensors nobody is reading:

- **PTT telemetry:** time since last press, press-queue depth, per-player share of floor time, declaration latency (how long between Pip finishing and someone pressing). A table that takes 90 seconds to act after every beat is confused or bored; the Director should see that number.
- **Box telemetry:** players idly scrolling inventory mid-scene is the digital equivalent of checking phones. Aggregate interaction patterns (never content) are a boredom signal.
- **Room energy meter:** one ambient mic measuring **loudness envelope only** — RMS energy, laughter spikes, dead silence. No transcription, no speech content, ever (this is also the privacy-correct design: off-mic talk stays unheard *semantically* while still informing pace). Laughter after a beat = it landed. Silence + no PTT = lost table.
- **Explicit micro-signal:** a one-tap pace control on every Box (a small "▲ more / ▼ ease up" pair, framed in-fiction as offering Hermys a token). Cheap, optional, and players use these when they exist.

These four feed a **Table State vector** (engagement, confusion, energy, per-player spotlight debt) that the Director receives every beat alongside game state. The tension dial stops being a knob the host turns and becomes a closed loop with the host override as backstop. The Director's pacing toolkit is explicit: cut to action, call a check, spotlight the quiet player (their Box lights up, Pip addresses their character by name), inject a timed pressure beat, or end the scene.

### 1.5 Visual fog-of-war by construction, not filtering **[NEW — addresses weak spot 9.2]**

Don't generate from scene text and then try to censor. Invert it:

1. Every renderable thing is an **Entity Card** (location, NPC, object) with its own reveal state and its own prompt fragment + anchor reference.
2. The Director emits a **Visible Manifest** for any image request: the exact list of entity cards (in their *current revealed state*) plus composition notes. The image prompt is assembled **only** from manifest cards. The module text is never in the image-prompt path at all. An unrevealed ambusher cannot appear in the image because nothing about it exists in the prompt.
3. **Prep-time variants:** during ingestion, scenes with known reveal transitions get pre-rendered in each state (mill exterior: quiet / visibly ablaze; shrine: chest closed / trap erupting). Cheap at prep time, instant at table time.
4. **Audit pass for improvised images only:** a small local VLM answers "does this image contain {hidden-entity descriptions}?" before display. It's a seatbelt, not the mechanism — the mechanism is (2).

The same manifest principle governs audio: SFX triggers come from revealed events only (the engine fires SFX off event-log entries, which are by definition things that happened *visibly* unless tagged secret).

### 1.6 Voice casting: a troupe, not a cast of thousands **[REFINE — decision 10]**

Local TTS will not give you forty distinct, characterful, consistent voices. It will give you **8–12 good base voices** with controllable style/pitch/pace. Embrace the radio-drama model: a **voice troupe**. Major NPCs (Nighthill, Escobert, Cyanwrath, Mondath, Leosin for this module) get a dedicated voice ID + style preset, locked in the registry. Minor NPCs draw from the troupe with modulation, and the registry guarantees the same minor NPC always gets the same troupe member + settings. This is honest about the §9.7 quality line and is also how actual audio dramas work; nobody complains.

### 1.7 X-card rewind semantics need definition **[REFINE — decision 14/18]**

Event sourcing makes state rewind trivial, but you cannot unsay narration, and assets/audio already fired. Define rewind as **re-branching, not erasure**: on X-card, the engine marks a rewind point, truncates *mechanical* state to the chosen event, and the Director receives a "this content is now a line; route around it" instruction plus a short Pip script for gracefully re-entering the fiction ("the thread of fate frays and reweaves…" — the Hermys fiction actually makes this diegetic, which is a genuinely nice property of the Codex). The skipped branch is retained in the log, flagged excluded-from-recaps.

### 1.8 Dice reporting: keep it social, make it frictionless **[KEEP — decision 7]**

No camera dice recognition, no trust policing. The Box shows a big d20 entry pad the moment a check is called, pre-loaded with the right modifier ("+5, advantage — enter your two rolls"). Players who'd rather speak the number can; the entry pad just makes the engine's job unambiguous. Statistical anomaly detection is not worth building for a friends table.

### 1.9 Smaller corrections

- **5e 2024 vs. the module:** HotDQ is 2014-era. Stat blocks in its appendix are fine to run under 2024 rules, but the ingestion review step must reconcile a few mechanics (e.g., surprise works differently in 2024 — it's initiative disadvantage, not a lost round). The ingestion schema needs a `rules_notes` field per encounter for exactly these patches.
- **Press-order floor queue in combat** is wrong; in combat, **initiative owns the floor** and PTT from the active player gets priority routing, with others queued as table-talk-to-Pip. Exploration uses press-order. Two floor modes, switched by engine state.
- **The shared screen is also the mixer** (see Part 4) — this collapses weak spot 9.6 from "real engineering" to "Web Audio graph," one of the biggest simplifications available.

---

## Part 2 — System architecture

### 2.1 Components

Seven services, one box, supervised by systemd (the Spark is Linux/aarch64; this is the launchctl-daemon pattern the owner already runs, ported):

```
┌─────────────────────────────────────────────────────────────┐
│  DGX Spark                                                  │
│                                                             │
│  ┌───────────┐   tools    ┌──────────────┐                  │
│  │ DIRECTOR  │◄──────────►│ GAME ENGINE  │◄──── SQLite      │
│  │ (Tally)   │            │ deterministic │      (events +   │
│  └─────┬─────┘            │ 5e SRD 5.2    │       state)     │
│        │ Narration Brief  └──────┬───────┘                  │
│        ▼                         │ state deltas             │
│  ┌───────────┐                   ▼                          │
│  │ NARRATOR  │           ┌──────────────┐                   │
│  │ (Pip)     │──────────►│ ORCHESTRATOR │◄── WebSocket hub  │
│  └───────────┘  prose    │  (gateway)   │    for all clients│
│                          └──┬───────┬───┘                   │
│  ┌───────────┐              │       │                       │
│  │ MEDIA SVC │◄─────────────┘       │                       │
│  │ TTS/STT/  │  jobs            ┌───▼────────┐              │
│  │ image     │                  │ ASSET STORE│              │
│  └───────────┘                  │ + registries│             │
│                                 └────────────┘              │
│  Inference substrate: LiteLLM → llama.cpp/vLLM (LLM),       │
│  faster-whisper (STT), TTS daemon, SDXL worker              │
└─────────────────────────────────────────────────────────────┘
        ▲ local WiFi (HTTPS/WSS, mDNS: hermys.local)
        │
  Player Boxes (PWA, phones) … Shared Screen (PWA, TV) … Host panel
```

**Game Engine** (TypeScript or Python; recommend TypeScript for shared types with the PWA). Owns all numbers. Pure-function rules core (SRD 5.2) + event store. Exposes a typed internal API consumed as LLM tools: `resolve_check`, `apply_damage`, `advance_initiative`, `move_entity`, `grant_item`, `reveal_fact`, `set_scene`, `query_state(scope)`. Every mutation is an appended event; current state is a fold over events with periodic snapshots.

**Director (Tally).** A loop, not a chat. Each tick it receives: current scene beat, full game state, full module pack (hidden + revealed), Table State vector, lines/veils, and the player's transcribed declaration if one is pending. It outputs tool calls (engine mutations, reveals) and a Narration Brief. It never produces player-facing prose.

**Narrator (Pip).** Stateless per call. Input: Narration Brief + rolling *revealed-only* scene transcript + tone profile. Output: prose, streamed sentence-by-sentence to the Media service for TTS, tagged with speaker IDs for NPC voice switching (`[voice:nighthill] "Thank the gods you've come."`).

**Orchestrator.** The realtime gateway: WebSocket hub for Boxes/screen/host, the PTT queue and floor-mode logic, session lifecycle, and the job conductor that sequences STT → Director → Engine → Narrator → TTS while enforcing the GPU schedule (Part 4.3).

**Media service.** Wraps the inference substrate: STT jobs (PTT clips), streaming TTS with the voice registry, image jobs (prep batch + live improv queue at low priority), and the VLM audit check.

**Boxes + Shared Screen.** One PWA codebase, three roles by login (player / screen / host). The screen client owns the **Web Audio mixing graph**: music bed (crossfade nodes), SFX bus, narration bus with sidechain-style ducking (gain automation triggered by TTS start/stop events). Phones never play audio; the room does.

**Asset store + registries.** Content-addressed files on disk; SQLite registries mapping entity → anchor image, LoRA, voice ID + style preset, music mood tags.

### 2.2 Who calls whom (one full turn)

1. Player holds PTT, speaks, releases. Box streams the clip → Orchestrator → STT. Transcript + speaker identity → Director.
2. Director classifies: trivial color (skip to brief), action requiring adjudication, or out-of-fiction (table admin). For an uncertain action it calls `resolve_check(actor, skill, dc_hidden, adv)` — the engine returns "awaiting roll," the Box gets a roll prompt, Pip voices the call ("Make me a Dexterity save, Kael").
3. Player enters/speaks the roll → engine resolves deterministically → events appended → state deltas pushed to subscribed Boxes/screen.
4. Director reads the outcome, decides reveals (`reveal_fact` events, possibly scoped to one character → that Box alone), updates the Visible Manifest if the scene changed, and emits the Narration Brief.
5. Narrator streams prose → TTS streams audio to the screen client → mixer ducks music → Boxes show any private reveals. Meanwhile, if an improv image was requested, it renders during playback and fades in when ready ("the vision sharpens" fallback if slow).

### 2.3 Data models (the load-bearing six)

```
Event            { id, ts, session, type, actor, payload, visibility:
                   'public' | 'gm' | ['char_ids…'], branch_id }
Character        { id, identity, srd_build (class/species/stats 2024),
                   derived (AC, slots, …, computed not stored), inventory,
                   conditions[], goals[], relationships[], box_unlocks[] }
EntityCard       { id, kind: npc|location|object|creature,
                   states: { state_id: { facts[], prompt_fragment,
                            anchor_asset, voice_ref? } },
                   current_state, reveal: { mode, revealed_to: party|[chars] },
                   stat_ref?  // engine stat block id, never inline text }
LocationGraph    { nodes: entity_card ids, edges: { from, to, kind, travel,
                   visibility }, per-char fog = derived from reveal events }
BeatGraph        { beats: { id, episode, type: scene|encounter|reveal|clock,
                   entry_conditions, narration_brief_seed, manifest_seed,
                   secrets[], rewards[], rules_notes, exits[] } }
Registries       { asset: entity→files, voice: entity→(voice_id, style),
                   music: mood_tag→tracks, lora: entity→adapter }
```

Per-character knowledge is **derived**: a fact is known to a character iff a `reveal_fact` event scoped to them (or party-public) exists. No second bookkeeping system; the fog-of-war, the recap generator, and the Box lore feed all query the same event stream with a visibility filter. This is the payoff of decision 14 and it should be treated as an invariant: **nothing player-visible exists except through visibility-tagged events.**

---

## Part 3 — Campaign ingestion pipeline (applied to HotDQ)

**Posture:** the pack is a private, removable directory (`packs/hotdq/`), never committed to the engine repo, never containing engine code. Ingestion produces *structured references and original paraphrase*, not bulk text. Boxed read-aloud passages are stored verbatim **inside the pack only** as Narrator-speakable seeds (personal use, local, never redistributed); everything else is reduced to facts.

**Pipeline (LLM-parse-then-human-review — resolving open decision §10.4):**

1. **Segment.** PDF → per-section text via the existing local stack. Identify boxed text, sidebars, stat blocks, tables, maps.
2. **Extract — beats.** LLM pass produces the BeatGraph per episode. For HotDQ Episode 1 this yields the arrival beat, the mandatory first encounter, the keep hub, the seven mission beats, the night clock (the module runs on an explicit timeline with missions consuming fixed time — model this as a literal clock resource in the engine), the wandering-encounter table as a stochastic beat generator, and the closing duel beat with its hostage constraint.
3. **Extract — entities.** Every named NPC, location, creature group → EntityCards with multi-state definitions where the module implies them (the mill has a "looks like arson" state and a "the fire is theater, ambushers above" state; the hatchery has "two visible eggs" / "third egg found"). Secrets become *unrevealed states*, which is what makes visual fog-of-war by construction work.
4. **Extract — stat blocks.** Appendix entries + Monster-Manual references → engine records. **This step is human-verified line by line** — it is the foundation everything narrates over, the module is short (eight-ish blocks plus MM references), and an hour of checking beats a session ruined by a wrong save DC. SRD 5.2 supplies the generic monsters; the appendix supplies the module-specific four. Apply 2024 reconciliation notes here (surprise, weapon mastery N/A for monsters, etc.).
5. **Reveal-tag.** Each fact in each card/beat tagged: `public_on_sight`, `check_gated(skill, dc)`, `event_gated(beat_id)`, `gm_only`. The module's secret-dense spots get special care — Episode 1's ambush, the rearguard, every Episode 3 trap, the hidden egg, and the off-limits cave each become explicitly gated states.
6. **Prep Bench review (the human-in-the-loop).** A simple web UI (same PWA shell, host role) showing each beat/card with: parsed facts vs. source page reference, reveal tags, manifest seed, and a "render preview" button. The owner walks Episode 1 in an hour, fixes tags, approves. Nothing unapproved enters a live session.
7. **Asset prep batch.** For approved cards: anchor portraits/locations via SDXL with a per-campaign style preset (the tone profile's visual half), variants per reveal state, LoRA training for the recurring stars only (this module: Cyanwrath, Mondath, the blue dragon, Nighthill, Leosin — five LoRAs, trained overnight). Voice casting from the troupe + dedicated presets for those same five. Music library tagged against the tone profile's mood vocabulary (siege, dread, tavern-warmth, triumph, scheming…).
8. **Showcase wiring.** The temple-siege door clock from the handover: ingested as a `clock` beat where each engine tick fires a bundled cue (ram SFX + door-HP tick on screen + music escalation step). This is pure data — the engine's clock mechanism plus the cue bundle format covers it with zero special-case code, which is the test that the beat schema is right.

---

## Part 4 — Stack

### 4.1 The constraint that decides everything

The GB10's 128 GB unified memory is generous; its **~273 GB/s memory bandwidth is not**. Token generation is bandwidth-bound, and every concurrent model competes for the same bus. Three consequences:

1. **MoE over dense.** GPT-OSS-120B (~5.1B active params, native MXFP4, ~61 GB resident) generates at usable speed because only active experts hit the bus per token. A dense 70B would crawl. The owner's existing default is the right model.
2. **One big model, two personas.** Director and Narrator are LiteLLM routes over the same resident server with different system prompts and context assemblers (per §1.3). The safety boundary is the assembler.
3. **Schedule, don't parallelize.** Turn-based play is bursty — the pipeline is sequential by nature (STT→think→speak), and the only true contention is image generation, which we slot into narration-playback windows.

### 4.2 Selections

| Layer | Choice | Rationale / fallback |
|---|---|---|
| LLM serving | **llama.cpp server** (GGUF, aarch64+CUDA) behind **LiteLLM** | Owner's existing routing pattern; llama.cpp's Spark support is solid. Fallback: vLLM if batch/tool-call ergonomics win out. |
| Director+Narrator | **GPT-OSS-120B** (one instance, two routes) | Per 4.1. High reasoning effort on Director route, lower on Narrator for latency. |
| Utility model | **Qwen3-4B-Instruct** (~3 GB) | Intent classification, PTT triage, reveal-tag suggestions, VLM-adjacent chores. Sub-200 ms calls. |
| STT | **faster-whisper, large-v3-turbo** | PTT clips are short and bounded; turbo transcribes a 10 s clip in well under a second. No streaming ASR needed — PTT buys us that. |
| TTS | **Kokoro-82M** as the workhorse (fast, light, stable) + one expressive model (XTTS-v2 or Orpheus-class) for the five star NPCs | Two-tier matches the troupe design (§1.6). Kokoro streams sentence-by-sentence with negligible bus impact. Quality line: if the expressive tier disappoints on-box, stars fall back to Kokoro+style and we accept it — narration quality (Pip) matters more than NPC timbre variety. |
| VLM audit | **Qwen3-VL small** (loaded on demand for improv images only) | Seatbelt check per §1.5. |
| Image | **SDXL** + per-entity LoRAs; **SDXL-Turbo/Lightning** for live improv (4-step) | LoRA tooling is mature for SDXL on consumer stacks; Flux is heavier on the bus for marginal gain here. Prep batch runs overnight, unscheduled. |
| Realtime | **FastAPI/Starlette or Node + WebSockets**, mDNS `hermys.local`, self-signed TLS pinned in the PWA | Phones on house WiFi; WSS required for mic access in browsers. |
| PWA | **SvelteKit** (or React if preferred), one codebase, role-gated | Box, screen, host, Prep Bench are four views of one app. |
| Audio mixing | **Web Audio API on the shared-screen client** | Ducking = gain automation; crossfade = two gain nodes; SFX = buffer sources. Eliminates weak spot 9.6 as a server-side problem entirely. |
| Storage | **SQLite** (event log, state snapshots, registries) + content-addressed asset files | One box, one writer, embarrassing reliability. |
| Process mgmt | **systemd units** (or docker compose if the CUDA aarch64 images cooperate) | Same daemon pattern as the owner's Mac stack. |

### 4.3 Concurrency plan (weak spot 9.3, head-on)

Steady-state residency: GPT-OSS-120B (~61 GB) + Whisper turbo (~3 GB) + Kokoro (~1 GB) + expressive TTS (~4 GB) + SDXL warm (~8 GB) + utility model (~3 GB) ≈ **80 GB**, comfortably inside 128 GB. Capacity is fine; the budget is bandwidth, managed by the Orchestrator's job conductor:

- **Priority classes:** P0 interactive (STT, Director/Narrator tokens, TTS) — never queued behind anything. P1 improv images — run only during narration playback or idle; preemptible. P2 prep jobs — never during a session.
- **The narration window trick:** a Pip beat is 10–40 s of audio. TTS for sentence N+1 takes a fraction of sentence N's playback. The slack is where improv images render. The player-perceived system is "always responsive" because the GPU works while the room listens.
- **Latency budget per turn:** PTT release → transcript ≤ 0.7 s → Director first tool call ≤ 2 s (prompt-cache the static module/system context; only the delta is new tokens) → Pip first audible syllable ≤ 4 s from release. If Director deliberation runs long, Pip has a sanctioned set of in-character holds ("Hermys weighs the threads…") — but the real fix is prompt caching plus the utility model fast-path for trivial turns.
- **Phase 0 benchmark gate (see Part 6):** measure exactly this pipeline before building on it. If 120B Director latency misses budget, the fallback ladder is: (a) lower reasoning effort in-turn + move heavy planning between turns (the Director pre-plans likely branches while players talk off-mic — *anticipatory planning is the single best latency weapon this design has*), (b) Qwen3-30B-A3B as Narrator, (c) only then consider any cloud spillover, which violates the local constraint and needs owner sign-off.

---

## Part 5 — Resolutions of the open decisions (§10)

1. **Box unlock binding → bind to the *character*.** A device-bound Box that carries powers when lent breaks the privacy model (decision 21) and the fiction both — the Box is "a shard of regard" *for a soul*, not a magic phone. Mechanically: `box_unlocks[]` lives on the Character record; logging any device into a character manifests that character's shard. A "lost/stolen Box" story beat, if ever wanted, is then a deliberate campaign event, not an accident of binding.
2. **Audience → build engine-as-product, pack-as-private** (per §1.1). No further decision needed now; the SRD 5.2 line keeps both futures open at zero extra cost beyond repo discipline.
3. **MVP map scope → theater-of-the-mind only for the slice, plus the location-graph mini-map.** Episode 1's opening plays fine ToM; the mini-map is nearly free because the LocationGraph must exist anyway, and it makes the Box feel alive on day one. Tactical maps arrive with Episode 3 (the dungeon genuinely needs them).
4. **Import automation → LLM-parse + mandatory Prep Bench review** (Part 3). Stat blocks always human-verified; everything else spot-checked. The Bench is a build deliverable, not an afterthought, because it's also the tool for authoring *original* packs later — which is the product path's content answer.

---

## Part 6 — Build sequence

Each phase ends in something demoable on the actual Spark. Order is chosen so the scariest unknowns die first.

**Phase 0 — The Bench (≈1 week).** No product code. Stand up llama.cpp + Whisper + Kokoro + SDXL on the Spark; script the full turn pipeline with canned inputs; measure the Part 4.3 latency budget and the narration-window trick under load. **Exit:** a numbers table proving (or pricing) the concurrency plan; model choices locked. *Kills weak spots 9.3, 9.5, 9.7 or forces the fallback ladder early.*

**Phase 1 — Engine core (≈2 weeks).** SRD 5.2 rules core, event store, character model, check/damage/initiative resolution, visibility-tagged events, snapshot/replay, rewind-as-rebranch. Playable from a CLI by typing declarations and roll results. **Exit:** a scripted skirmish (four PCs vs. eight kobolds) runs to completion deterministically from a seed; replaying the log reproduces it exactly.

**Phase 2 — The two-tier brain, text only (≈2 weeks).** Director loop with engine tools; context assembler enforcing the revealed-slice boundary; Narration Brief schema; Narrator route; canon-capture for Pip inventions; recap generator off the event log. **Exit:** a full text-mode play session of a hand-authored mini-scene, plus a **red-team session**: an adversarial player spends thirty minutes trying to extract a planted secret through Pip. Zero leaks is the bar.

**Phase 3 — Voice loop (≈2 weeks).** PWA shell with PTT (mic capture, queue, floor modes), STT path, streaming TTS, shared-screen client with the Web Audio mixer (music bed, ducking, SFX bus). **Exit:** four phones + one TV play the Phase-2 scene entirely by voice in one room; floor control feels right with real humans interrupting each other.

**Phase 4 — Boxes in full (≈2 weeks).** Character sheet, inventory, spells with slot validation, roll pad, private reveals, mini-map over the LocationGraph, X-card wired to rewind, pace micro-signal, Table State vector feeding the Director, host panel. **Exit:** a session where a private reveal goes to exactly one phone, an X-card rewind lands gracefully, and the Director demonstrably reacts to a stalling table.

**Phase 5 — Content pipeline (≈2 weeks, overlaps 4).** Ingestion passes + Prep Bench; Episode 1 parsed, reviewed, reveal-tagged; asset prep batch (anchors, variants, five LoRAs, voice casting, mood-tagged music library); Visible-Manifest renderer + VLM audit; character-creation voice interview with tap fallbacks, ending in the portrait-anchor moment.
**Exit:** Episode 1 exists as an approved pack; every named entity has an anchor, a voice, and reveal states; the door-clock showcase fires SFX + screen + music from pure data.

**Phase 6 — The vertical slice (≈1–2 weeks).** The handover's recommended target: grasslands approach → dragon over the burning town → the family-and-kobolds first fight → reaching the keep and meeting the governor and castellan. Full pipeline, four real players, two sessions. **Win condition as specified: no secret leaks in text, audio, or image** — audited afterward by replaying the event log against the module's hidden layer. Secondary metrics: latency budget held; at least one improv image delivered inside a narration window; recap auto-generated and read cold at session two's open.

Total: roughly **10–12 weeks** of focused part-time build, with Phase 0 as the go/no-go gate.

---

## Part 7 — Risk register (residual)

| Risk | Likelihood | Mitigation |
|---|---|---|
| 120B Director latency misses budget even with caching | Medium | Anticipatory planning between turns (4.3); Narrator on 30B-A3B; reasoning-effort routing |
| Expressive TTS underwhelms locally | Medium | Troupe design already absorbs it; stars fall back to Kokoro+style |
| Ingestion misses an implicit secret (module prose is sneaky) | Medium | Prep Bench review is mandatory; red-team pass per episode, not just once |
| WiFi flakiness mid-session | Low | PWA offline shell + auto-reconnect; engine state is server-side so nothing is lost |
| 2024-rules edge cases vs. 2014 module | Low | `rules_notes` patch field; reconcile at review time |
| Scope creep toward tactical maps early | High (knowing this owner) | They're Phase 7. The slice wins on voice, fog, and feel. |

---

*The Codex fiction is kept as-is — it earns its place: the two faces map to the architecture, the four chains map to the invariants, and the X-card rewind even gets a diegetic excuse. Scripture that documents the system is good scripture.*
