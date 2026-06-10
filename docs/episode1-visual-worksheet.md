# Episode 1 — visual prep worksheet

The checklist the Prep Bench review walks when the ingestion drafts land:
does every scene below exist as an entity card with these *states*, so the
render planner emits its anchors and variants? Reference-level only —
detail comes from the pack (private); this page deliberately carries no
module prose. Vocabulary is the build plan's own (§1.5, §3, Phase 6).

## Locations (anchor + listed state variants)

| Card | States to pre-render | Why |
|---|---|---|
| grasslands approach | day-calm · night-glow-on-horizon | the slice's opening shot |
| the town from afar | intact · burning | the dragon-over-town beat needs the before/after |
| town streets | chaos-by-night | the running fight backdrop |
| the mill | quiet · visibly-ablaze · ambush-sprung | the §1.5 worked example: "looks like arson" vs "the fire is theater" |
| the keep, exterior | gates-shut · gates-open | arrival vs sally |
| the keep, courtyard | crowded-with-refugees | the hub's establishing |
| keep interiors (hall / walls) | candle-lit | Nighthill and Escobert conversations |
| the chapel | besieged · relieved | the door-clock showcase: render both ends of the clock |
| the camp (distant view) | night-fires | the closing reveal of scale |
| the duel ground | torch-ring | the champion's challenge beat |

## The five stars (LoRA queue, P1 — portrait anchor + listed variants)

| Card | Variants | Voice note (registry, not render) |
|---|---|---|
| Nighthill | composed · wounded | dedicated preset |
| Escobert | on-the-walls | troupe + preset |
| Mondath | robed · unmasked-intent | dedicated preset |
| Cyanwrath | challenge-posture | dedicated preset; unrevealed_alias until named |
| the blue dragon | distant-silhouette · overhead-terror | never a close portrait in E1 — distance is the dread |

## Objects / set pieces

- the chapel door (intact · splintering — clock thresholds may swap mid-beat)
- the banner of the raiders (seen-at-distance first; identity is gated)
- the prisoner-exchange table dressing for the closing negotiation

## Rules of the pass

1. Every star gets `unrevealed_alias` set before any portrait is shown —
   Pip narrates from the alias until the reveal event fires.
2. Hidden states (`ambush-sprung`, `unmasked-intent`) are rendered at prep
   but live behind reveal gates — `vision` will refuse them in any live
   manifest until the card transitions. That refusal is the system working.
3. The dragon renders only as silhouette/overhead in E1; put the close-up
   in the plan as P3 for later episodes, not in any E1 manifest.
4. After Bench approval: `cd vision && npm run plan -- --stars
   npc.nighthill,npc.escobert,npc.mondath,npc.cyanwrath,creature.blue_dragon`
   and hand `render-plan.json` to the Spark batch (runbook step 13).
