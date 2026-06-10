/** Append-only, branch-aware event store. Invariant: nothing player-visible
 *  exists except through visibility-tagged events. SQLite in production;
 *  in-memory + JSONL here — the interface is what matters. */

export type Visibility = "public" | "gm" | string[]; // string[] = character ids

export interface GameEvent {
  id: number;                 // monotonic per store
  branch: string;
  type: string;
  actor: string | null;
  visibility: Visibility;
  payload: Record<string, unknown>;
  causes?: number;
}

interface Branch { id: string; parent: string | null; cutAt: number | null }

export class EventStore {
  private events: GameEvent[] = [];
  private branches = new Map<string, Branch>([["main", { id: "main", parent: null, cutAt: null }]]);
  private active = "main";
  private nextId = 1;

  append(e: Omit<GameEvent, "id" | "branch">): GameEvent {
    const ev: GameEvent = { id: this.nextId++, branch: this.active, ...e };
    this.events.push(ev);
    return ev;
  }

  /** X-card / rewind: open a new branch cut at `eventId`. The old branch is
   *  retained (auditable) but excluded from folds and recaps. */
  rebranch(eventId: number, newId: string): void {
    if (!this.events.some(e => e.id === eventId)) throw new Error("unknown event");
    this.branches.set(newId, { id: newId, parent: this.active, cutAt: eventId });
    this.active = newId;
  }

  activeBranch(): string { return this.active; }

  /** Events on the active lineage: walk parents, honoring cut points. */
  timeline(): GameEvent[] {
    const lineage: Branch[] = [];
    for (let b = this.branches.get(this.active); b; b = b.parent ? this.branches.get(b.parent) : undefined)
      lineage.unshift(b);
    const out: GameEvent[] = [];
    for (let i = 0; i < lineage.length; i++) {
      const b = lineage[i];
      const cut = lineage[i + 1]?.cutAt ?? Infinity; // child's cut bounds the parent
      for (const e of this.events) if (e.branch === b.id && e.id <= cut) out.push(e);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  /** Player-facing slice: what this character is allowed to see. */
  visibleTo(charId: string): GameEvent[] {
    return this.timeline().filter(e =>
      e.visibility === "public" ||
      (Array.isArray(e.visibility) && e.visibility.includes(charId)));
  }

  toJSONL(): string { return this.events.map(e => JSON.stringify(e)).join("\n"); }

  static fromJSONL(jsonl: string): EventStore {
    const s = new EventStore();
    for (const line of jsonl.split("\n").filter(Boolean)) {
      const e = JSON.parse(line) as GameEvent;
      s.events.push(e);
      s.nextId = Math.max(s.nextId, e.id + 1);
    }
    return s;
  }
}
