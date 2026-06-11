/** The recap generator: a filtered fold over visibleTo. No second
 *  bookkeeping — what a character can be reminded of is exactly what their
 *  Box was allowed to see (invariant 2), which also means rewound branches
 *  fall out for free (their events aren't on the active timeline). */

import type { IEventStore, GameEvent } from "../../engine/src/store.js";

/** Deterministic recap lines for one character ("party" = public only). */
export function recapLines(store: IEventStore, charId: string | "party"): string[] {
  const events: GameEvent[] = charId === "party"
    ? store.timeline().filter(e => e.visibility === "public")
    : store.visibleTo(charId);

  const lines: string[] = [];
  for (const e of events) {
    const p = e.payload as any;
    switch (e.type) {
      case "scene_set":
        lines.push(`You came to ${p.name}.`); break;
      case "fact_revealed":
        lines.push(`You learned: ${p.text}`); break;
      case "canon_ratified":
        lines.push(`Established: ${p.assertion}`); break;
      case "combat_started":
        lines.push(`A fight broke out.`); break;
      case "combat_ended":
        lines.push(p.winner === "pc" ? `You won the fight.` : `The fight went badly.`); break;
      case "condition_changed":
        if (p.added === "dead") lines.push(`${p.target} fell.`);
        if (p.added === "stable") lines.push(`${p.target} was stabilized.`);
        break;
      case "health_tier_changed":
        if (p.tier === "down") lines.push(`${p.target} went down.`);
        break;
    }
  }
  return lines;
}

export function renderRecap(store: IEventStore, charId: string | "party"): string {
  const lines = recapLines(store, charId);
  return lines.length ? `Previously:\n${lines.map(l => `  • ${l}`).join("\n")}` : "Previously: the story is just beginning.";
}
