# Campaign roadmap — leveling, onboarding, and playable scenes end to end

Goal: every scene of the campaign playable with the full presentation
stack — map node, palette/mood, encounters into the combat HUD, dialogue
rails at hand — plus the two player-facing flows still missing: leveling
up and a welcoming first contact. The host drives beats from their panel
today; the AI Director takes the same data on the Spark.

Boundary as ever: generic infrastructure + original demo content → public
repo; HotDQ-derived presentation data → the private pack repo.

## Worklist (in order)

1. **Level-up UI.** Host panel grants a level-up per character (hub
   command, host-gated) → the Box gets a level-up moment: HP choice
   (take the average, or roll — tap-grid hit die), engine validates,
   sheet animates the new maximum, screen cues "[a hero grows]". Gates:
   hub grant flow, refusals surface, fold updates, non-hosts refused.
2. **Onboarding polish.** First contact feels like an invitation, not a
   form: redesigned join screen (role cards with descriptions, not a
   select), "welcome back" rebind shortcut (last character remembered
   per device), interview gains a progress trail and a back button
   (step machine supports stepping back without losing the draft),
   friendlier error states. Browser-verified.
3. **Demo scene #2 — The Salt Mill (original).** A five-node
   LocationGraph (mill, loft, brine channel, sluice gate, village road),
   Old Marta with keyword dialogue rails, a brine-crawler encounter
   (original creature stat block) the host can spring, one private
   reveal, palettes/moods per location. Scene selectable at server start
   (HERMYS_SCENE) and exercised by an extended demo gate.
4. **Campaign pack loader (public infra).** The orchestrator loads a
   "presentation pack" JSON (location graph + per-beat scene data +
   encounter specs + dialogue card references); a host Beat Navigator
   panel lists beats, one tap sets the scene (palette, mood, map node),
   springs its encounter into initiative, and shows the beat's dialogue
   cards/sanctioned hints to the host seat only. Clients keep receiving
   only events — the pack stays server-side. Gates: loader validation,
   beat navigation flow, gm-only data never leaves the host feed.
5. **HotDQ presentation pack (PRIVATE repo).** Generate from the
   narrative data already there: location-graph.json per episode (nodes
   from beats' locations, edges from exits), palette/mood per beat
   (derived from narration_brief_seed registers + the campaign palette
   vocabulary), encounter specs from beat encounter groups (stat refs
   resolve via SRD + the five hand-entered blocks when present), and the
   dialogue-card index per beat. Tool script in the pack repo,
   regenerable; output validates against the public loader.
6. **Campaign gate.** Public: extended demo-gate runs the Salt Mill
   (travel all five nodes, dialogue keyword, encounter to victory,
   level-up after). Private-side check: Episode 1's beat graph loads in
   the navigator, first three beats walk with correct maps/palettes and
   their encounters spring (host-driven, mock media) — the "a human can
   run session one tonight" proof.

## Standing rules

Same as always: suites green before commits, gate tests for new
mechanics, browser-verify visuals, push + watch CI, mock seams only,
pack boundary enforced (the loader is public; every byte of HotDQ data is
private), original prose only in the public repo.
