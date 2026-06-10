/** The prep-batch render planner (build plan §1.5.3, Part 3 step 7).
 *  Walks pack drafts and enumerates EVERY card state that can render —
 *  anchors for current states, variants for every reveal transition the
 *  module implies — so reveals at the table are instant asset swaps, not
 *  renders. Output is pure data the Spark batch consumes overnight.
 *
 *  Prep renders deliberately include hidden states (the ambush variant is
 *  pre-rendered so springing it costs nothing); the plan therefore lives
 *  with the pack, gitignored, never in the engine repo's public surface.
 *
 *  Determinism: each job's seed derives from entity/state, so re-running
 *  the planner never invalidates previously rendered assets. */

import { preset, type StylePreset } from "./style.js";
import type { Card } from "./assemble.js";

export interface RenderJob {
  id: string;                 // entity/state, stable
  entity_id: string;
  state: string;
  kind: "anchor" | "variant";
  role_hint: "location" | "portrait" | "object";
  prompt: string;
  negative: string;
  seed: number;
  params: StylePreset["params"];
  needs_lora: boolean;        // recurring star: train a LoRA before variants
  priority: 1 | 2 | 3;        // 1 stars, 2 locations, 3 the rest
}

export interface RenderPlan {
  style: string;
  jobs: RenderJob[];
  loras: string[];            // entities that need LoRA training first
  summary: { anchors: number; variants: number; byPriority: Record<number, number> };
}

const FRAMING: Record<string, string> = {
  location: "wide establishing shot",
  portrait: "three-quarter character portrait, plain dark backdrop",
  object: "centered still-life study, plain dark backdrop",
};

export function planRenders(cards: Card[], beats: Record<string, any>[],
                            opts: { style?: string; stars?: string[] } = {}): RenderPlan {
  const style = preset(opts.style);
  const appearances = countAppearances(beats);
  // stars: named explicitly, or any card on stage in 3+ beats — they recur
  // enough that identity drift would show, so they get LoRAs.
  const stars = new Set(opts.stars ?? []);
  for (const [id, n] of appearances) if (n >= 3) stars.add(id);

  const jobs: RenderJob[] = [];
  for (const card of cards) {
    const roleHint = card.kind === "location" ? "location"
                   : card.kind === "object" ? "object" : "portrait";
    for (const [stateId, state] of Object.entries<any>(card.states ?? {})) {
      if (!state.prompt_fragment) continue; // nothing renderable in this state
      const isStar = stars.has(card.id);
      jobs.push({
        id: `${card.id}/${stateId}`,
        entity_id: card.id,
        state: stateId,
        kind: stateId === card.current_state ? "anchor" : "variant",
        role_hint: roleHint,
        prompt: `${style.prefix} ${state.prompt_fragment}, ${FRAMING[roleHint]}${style.suffix}`,
        negative: style.negative,
        seed: fnv1a(`${card.id}/${stateId}`),
        params: style.params,
        needs_lora: isStar,
        priority: isStar ? 1 : card.kind === "location" ? 2 : 3,
      });
    }
  }
  jobs.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const byPriority: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  for (const j of jobs) byPriority[j.priority]++;
  return {
    style: style.id,
    jobs,
    loras: [...stars].filter(id => cards.some(c => c.id === id)).sort(),
    summary: {
      anchors: jobs.filter(j => j.kind === "anchor").length,
      variants: jobs.filter(j => j.kind === "variant").length,
      byPriority,
    },
  };
}

function countAppearances(beats: Record<string, any>[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const b of beats)
    for (const id of (b.entities ?? []) as string[])
      n.set(id, (n.get(id) ?? 0) + 1);
  return n;
}

/** FNV-1a — stable 32-bit seed per entity/state, no RNG involved. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
