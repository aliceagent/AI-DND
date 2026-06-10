/** Gate: SQLite behind the same EventStore interface. Same skirmish, same
 *  seeds ⇒ byte-identical JSONL against the in-memory store; rewind works;
 *  JSONL import/export round-trips; a file-backed store survives reopening. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runSkirmish, fold } from "./helpers.js";
import { EventStore } from "../src/store.js";
import { SqliteEventStore } from "../src/sqlite.js";
import { activeOnSide } from "../src/state.js";
import { PCS } from "../src/srd.js";

test("sqlite skirmish is byte-identical to the in-memory skirmish", () => {
  const mem = runSkirmish(42, 99, new EventStore());
  const sql = runSkirmish(42, 99, new SqliteEventStore());
  assert.equal(sql.store.toJSONL(), mem.store.toJSONL());
  assert.deepEqual(sql.state(), mem.state());
});

test("visibility filtering is identical across stores", () => {
  const mem = runSkirmish(2024, 2025, new EventStore());
  const sql = runSkirmish(2024, 2025, new SqliteEventStore());
  for (const pc of PCS)
    assert.deepEqual(sql.store.visibleTo(pc.ref), mem.store.visibleTo(pc.ref));
});

test("rewind-as-rebranch works on sqlite", () => {
  const eng = runSkirmish(555, 777, new SqliteEventStore());
  const timeline = eng.store.timeline();
  const mid = timeline[Math.floor(timeline.length / 2)];
  eng.rewindTo(mid.id, "xcard-1");
  assert.equal(eng.store.activeBranch(), "xcard-1");
  assert.equal(eng.state().combatOver, false, "rewound state should be mid-fight");

  const foes = activeOnSide(eng.state(), "npc");
  assert.ok(foes.length >= 1);
  eng.pcAttack("pc.fighter", foes[foes.length - 1].id, PCS[0].attacks[0], 20, [8]);
  const raw = eng.store.toJSONL();
  assert.ok(raw.includes('"branch":"main"') && raw.includes('"branch":"xcard-1"'),
    "both branches retained in the raw log");
});

test("JSONL round-trips through sqlite, and replay folds identically", () => {
  const eng = runSkirmish(7, 11, new SqliteEventStore());
  const jsonl = eng.store.toJSONL();
  assert.equal(SqliteEventStore.fromJSONL(jsonl).toJSONL(), jsonl);
  // cross-store portability: the leak-audit replay can run from either store
  assert.deepEqual(fold(EventStore.fromJSONL(jsonl).timeline()), eng.state());
  assert.deepEqual(fold(SqliteEventStore.fromJSONL(jsonl).timeline()), eng.state());
});

test("a file-backed store survives close and reopen, branch intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermys-"));
  const path = join(dir, "session.db");
  try {
    const store = new SqliteEventStore(path);
    const eng = runSkirmish(1234, 5678, store);
    const mid = eng.store.timeline()[10];
    eng.rewindTo(mid.id, "xcard-1");
    const expectJsonl = store.toJSONL();
    const expectTimeline = store.timeline().length;
    store.close();

    const reopened = new SqliteEventStore(path);
    assert.equal(reopened.activeBranch(), "xcard-1");
    assert.equal(reopened.toJSONL(), expectJsonl);
    assert.equal(reopened.timeline().length, expectTimeline);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
