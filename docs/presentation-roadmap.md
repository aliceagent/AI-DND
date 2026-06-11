# Presentation roadmap — the screen earns its place

Goal: the shared screen and the Boxes feel like a produced show, not a
debug view. Players always know WHERE they are, every spoken word is
readable, every sound has a visual twin (a hearing-impaired player is a
first-class player), and entering a location is a *moment*: establishing
visual, title, music shift, then play.

## Principles

1. **Audio/visual parity.** Narration is always captioned; SFX and music
   changes render as visual cues; nothing is conveyed by sound alone.
   Symmetrically: nothing critical is conveyed by image alone (captions
   describe establishing shots).
2. **Graceful art degradation.** Every visual slot renders THREE ways with
   one layout: rendered art (Spark) → styled procedural backdrop (palette
   gradients + sigils, today) → text card. Swapping art in changes zero
   code.
3. **The screen directs attention; the Box informs the player.** Screen =
   place, moment, who's up, what was said. Box = you: sheet, knowledge,
   rolls. Never duplicate, never compete.
4. **Scene state is fiction state**: location and transitions ride the
   event log (`scene_set`, `entity_moved` — both in the schema enum), so
   maps, banners, and recaps stay pure folds. No presentation side-channel.

## Worklist (in order; every item Mac-green, browser-verified)

1. **Scene plumbing (engine + orchestrator).** `engine.setScene(location)`
   → public `scene_set` {location_id, name, mood, palette}; party location
   in the fold; `entity_moved` for travel. EchoDM opens with a scene and
   moves on travel-ish declarations. Hub broadcasts; gates: fold/replay,
   visibility, scene in recaps.
2. **The establishing moment (screen).** Scene-state machine on the
   shared screen: `scene_set` → full-bleed establishing layer (asset if
   the location card carries one, else procedural palette backdrop +
   location sigil), location title typography, opening narration as a
   timed caption, music-mood chip; crossfade in/out; settles to play
   layout. Reduced-motion honors instant cuts.
3. **Captions as a first-class citizen.** Always-on caption band on the
   screen: speaker-labeled (Pip / NPC name), high-contrast, room-readable,
   word-paced to the narration window. SFX render as bracketed visual
   cues ("[the ram strikes]"), music changes as a mood chip ("⏵ siege,
   rising"). Box: narration mirrors in the transcript (exists), plus
   vibration on narration start / your-turn / private reveal (Vibration
   API), and an a11y settings sheet per device: caption size, high
   contrast, reduce motion, haptics on/off — persisted locally.
4. **Combat HUD.** Screen: initiative strip (public order, current actor
   highlighted, round counter, monster health as descriptive tier pips),
   floor-mode indicator. Box: unmissable "YOUR TURN" banner + haptic;
   check calls show who else is being asked.
5. **Location awareness / the mini-map.** LocationGraph for the demo
   scene (original content): nodes/edges with visited-fog derived from
   `scene_set`/`entity_moved` events. Box gets a Map tab (you-are-here,
   visited nodes only) + a persistent location banner; the screen shows
   the map as a corner inset during travel beats. SVG, palette-styled.
6. **Polish pass.** Type scale + rhythm across both clients; motion
   timing curves; ambient particle layer per palette (drifting ash/embers,
   cave dust) behind the screen's play layout; styled private-reveal
   banner on the Box ("only you notice…"); the X-card moment as a calm,
   respectful thread-frays transition (never jarring); roll pad upgraded
   to a big tap-grid d20 pad.
7. **Presentation demo gate.** One scripted browser walkthrough: scene
   opens (establishing → title → captioned narration) → declaration →
   check captioned + rolled → combat starts (HUD, turn banner) → private
   reveal (Box banner, screen shows nothing) → travel (map updates,
   new establishing) — screenshots at each stage, clean console, and the
   whole run repeated with reduce-motion + captions-large to prove a11y
   parity.

## Out of scope (waits)

Real rendered art and TTS timing sync (Spark); room loudness meter
(hardware); tactical battle maps (Phase 7 by design — the mini-map is the
LocationGraph view, not a grid).
