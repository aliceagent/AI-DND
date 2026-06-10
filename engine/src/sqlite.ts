/** SQLite event store — the production implementation of IEventStore.
 *  Same semantics as the in-memory store, byte-identical JSONL export,
 *  durable on disk (pass a path) or ephemeral (":memory:", tests).
 *  Snapshots live in their own table: derived cache, never exported. */

import Database from "better-sqlite3";
import type { IEventStore, GameEvent, Visibility, Snapshot } from "./store.js";

interface BranchRow { id: string; parent: string | null; cutAt: number | null }

export class SqliteEventStore implements IEventStore {
  private db: Database.Database;
  private nextId: number;
  private active: string;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY,
        branch TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        visibility TEXT NOT NULL,
        payload TEXT NOT NULL,
        causes INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_events_branch ON events(branch, id);
      CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        parent TEXT,
        cut_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        event_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.db.prepare(
      "INSERT OR IGNORE INTO branches (id, parent, cut_at) VALUES ('main', NULL, NULL)").run();
    this.db.prepare(
      "INSERT OR IGNORE INTO meta (key, value) VALUES ('active_branch', 'main')").run();
    this.active = (this.db.prepare("SELECT value FROM meta WHERE key = 'active_branch'")
      .get() as { value: string }).value;
    const max = (this.db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM events")
      .get() as { m: number }).m;
    this.nextId = max + 1;
  }

  append(e: Omit<GameEvent, "id" | "branch">): GameEvent {
    const ev: GameEvent = { id: this.nextId++, branch: this.active, ...e };
    this.db.prepare(
      "INSERT INTO events (id, branch, type, actor, visibility, payload, causes) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(ev.id, ev.branch, ev.type, ev.actor, JSON.stringify(ev.visibility),
           JSON.stringify(ev.payload), ev.causes ?? null);
    return ev;
  }

  rebranch(eventId: number, newId: string): void {
    const exists = this.db.prepare("SELECT 1 FROM events WHERE id = ?").get(eventId);
    if (!exists) throw new Error("unknown event");
    this.db.prepare("INSERT INTO branches (id, parent, cut_at) VALUES (?, ?, ?)")
      .run(newId, this.active, eventId);
    this.active = newId;
    this.db.prepare("UPDATE meta SET value = ? WHERE key = 'active_branch'").run(newId);
  }

  activeBranch(): string { return this.active; }

  timeline(): GameEvent[] {
    const branches = new Map<string, BranchRow>();
    for (const r of this.db.prepare("SELECT id, parent, cut_at AS cutAt FROM branches")
      .all() as BranchRow[]) branches.set(r.id, r);
    const lineage: BranchRow[] = [];
    for (let b = branches.get(this.active); b; b = b.parent ? branches.get(b.parent) : undefined)
      lineage.unshift(b);
    const out: GameEvent[] = [];
    const q = this.db.prepare(
      "SELECT id, branch, type, actor, visibility, payload, causes FROM events WHERE branch = ? AND id <= ? ORDER BY id");
    for (let i = 0; i < lineage.length; i++) {
      const cut = lineage[i + 1]?.cutAt ?? Number.MAX_SAFE_INTEGER; // child's cut bounds the parent
      for (const row of q.all(lineage[i].id, cut) as any[]) out.push(rowToEvent(row));
    }
    return out.sort((a, b) => a.id - b.id);
  }

  visibleTo(charId: string): GameEvent[] {
    return this.timeline().filter(e =>
      e.visibility === "public" ||
      (Array.isArray(e.visibility) && e.visibility.includes(charId)));
  }

  saveSnapshot(eventId: number, state: unknown): void {
    this.db.prepare("INSERT OR REPLACE INTO snapshots (event_id, state) VALUES (?, ?)")
      .run(eventId, JSON.stringify(state));
  }

  nearestSnapshot(timeline: GameEvent[]): Snapshot | null {
    const ids = new Set(timeline.map(e => e.id));
    let best = -1;
    for (const r of this.db.prepare("SELECT event_id AS id FROM snapshots").all() as { id: number }[])
      if (r.id > best && ids.has(r.id)) best = r.id;
    if (best === -1) return null;
    const row = this.db.prepare("SELECT state FROM snapshots WHERE event_id = ?")
      .get(best) as { state: string };
    return { eventId: best, state: JSON.parse(row.state) };
  }

  /** Byte-identical to the in-memory store's export for the same events. */
  toJSONL(): string {
    const rows = this.db.prepare(
      "SELECT id, branch, type, actor, visibility, payload, causes FROM events ORDER BY id").all() as any[];
    return rows.map(r => JSON.stringify(rowToEvent(r))).join("\n");
  }

  static fromJSONL(jsonl: string, path = ":memory:"): SqliteEventStore {
    const s = new SqliteEventStore(path);
    const insert = s.db.prepare(
      "INSERT INTO events (id, branch, type, actor, visibility, payload, causes) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const line of jsonl.split("\n").filter(Boolean)) {
      const e = JSON.parse(line) as GameEvent;
      insert.run(e.id, e.branch, e.type, e.actor, JSON.stringify(e.visibility),
                 JSON.stringify(e.payload), e.causes ?? null);
      s.nextId = Math.max(s.nextId, e.id + 1);
    }
    return s;
  }

  close(): void { this.db.close(); }
}

/** Reassemble in the exact key order the in-memory store serializes with,
 *  omitting `causes` when absent — JSONL exports stay byte-identical. */
function rowToEvent(r: any): GameEvent {
  const e: GameEvent = {
    id: r.id, branch: r.branch, type: r.type,
    visibility: JSON.parse(r.visibility) as Visibility,
    payload: JSON.parse(r.payload), actor: r.actor,
  };
  if (r.causes !== null) e.causes = r.causes;
  return e;
}
