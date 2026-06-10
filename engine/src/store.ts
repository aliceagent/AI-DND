/** Append-only, branch-aware event store. Invariant: nothing player-visible
 *  exists except through visibility-tagged events. Two implementations share
 *  this interface: the in-memory store here (tests, demos) and the SQLite
 *  store in sqlite.ts (production). JSONL import/export is the portability
 *  and leak-audit format for both. */

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

export interface Snapshot { eventId: number; state: unknown }

/** The contract the engine codes against. SQLite slots in behind this. */
export interface IEventStore {
  append(e: Omit<GameEvent, "id" | "branch">): GameEvent;
  rebranch(eventId: number, newId: string): void;
  activeBranch(): string;
  timeline(): GameEvent[];
  visibleTo(charId: string): GameEvent[];
  toJSONL(): string;
  /** Snapshots are a derived cache keyed to event ids — never events
   *  themselves, never exported, always regenerable from the log. */
  saveSnapshot(eventId: number, state: unknown): void;
  nearestSnapshot(timeline: GameEvent[]): Snapshot | null;
}

interface Branch { id: string; parent: string | null; cutAt: number | null }

export class EventStore implements IEventStore {
  private events: GameEvent[] = [];
  private branches = new Map<string, Branch>([["main", { id: "main", parent: null, cutAt: null }]]);
  private active = "main";
  private nextId = 1;
  private snapshots = new Map<number, string>(); // eventId -> serialized state

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

  saveSnapshot(eventId: number, state: unknown): void {
    this.snapshots.set(eventId, JSON.stringify(state));
  }

  /** Latest snapshot whose event id lies on the given timeline — a snapshot
   *  taken past a rewind cut is automatically invisible to the new branch. */
  nearestSnapshot(timeline: GameEvent[]): Snapshot | null {
    const ids = new Set(timeline.map(e => e.id));
    let best = -1;
    for (const id of this.snapshots.keys()) if (id > best && ids.has(id)) best = id;
    return best === -1 ? null : { eventId: best, state: JSON.parse(this.snapshots.get(best)!) };
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
