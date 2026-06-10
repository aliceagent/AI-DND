/** Gate: snapshots keyed to event ids. state() folds from the nearest
 *  snapshot on the active lineage; a rewind past a snapshot invalidates it
 *  naturally (its event id falls off the new branch's timeline). Snapshots
 *  are cache, not truth: never exported, always regenerable. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scene, runSkirmish, fold } from "./helpers.js";
import { EventStore } from "../src/store.js";
import { SqliteEventStore } from "../src/sqlite.js";

test("folding from a snapshot equals folding from event 1", () => {
  for (const store of [new EventStore(), new SqliteEventStore()]) {
    const eng = scene(31, store, 2);
    eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 15, [6]);
    const at = eng.snapshotNow();
    assert.ok(at != null);
    eng.pcAttack("pc.rogue", "kobold.2", { toHit: 5, damage: "1d6+3" }, 18, [4]);
    eng.castSpell("pc.wizard", 1);
    assert.deepEqual(eng.state(), fold(eng.store.timeline()));
  }
});

test("state() actually reads the snapshot (a poisoned one shows through)", () => {
  const eng = scene(32);
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 15, [6]);
  const tl = eng.store.timeline();
  const tip = tl[tl.length - 1].id;
  const poisoned = { ...eng.state(), facts: { planted_by_snapshot: ["*"] } };
  eng.store.saveSnapshot(tip, poisoned);
  assert.deepEqual(eng.state().facts.planted_by_snapshot, ["*"],
    "fold did not start from the snapshot");
});

test("a rewind cutting before the snapshot invalidates it", () => {
  const eng = scene(33);
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 15, [6]);
  const mid = eng.store.timeline()[3].id;
  eng.pcAttack("pc.rogue", "kobold.1", { toHit: 5, damage: "1d6+3" }, 17, [5]);
  const tip = eng.store.timeline().at(-1)!.id;
  eng.store.saveSnapshot(tip, { ...eng.state(), facts: { stale: ["*"] } });
  eng.rewindTo(mid, "xcard-1");
  assert.equal(eng.state().facts.stale, undefined,
    "a snapshot past the cut leaked into the rewound branch");
});

test("a snapshot before the cut still serves the new branch", () => {
  const eng = scene(34, undefined, 2);
  eng.pcAttack("pc.fighter", "kobold.1", { toHit: 5, damage: "1d8+3" }, 15, [6]);
  const at = eng.snapshotNow()!;
  eng.pcAttack("pc.rogue", "kobold.2", { toHit: 5, damage: "1d6+3" }, 18, [4]);
  eng.rewindTo(eng.store.timeline().at(-1)!.id, "xcard-1");
  eng.castSpell("pc.cleric", 1);
  const snap = eng.store.nearestSnapshot(eng.store.timeline());
  assert.equal(snap?.eventId, at, "pre-cut snapshot should still be the nearest");
  assert.deepEqual(eng.state(), fold(eng.store.timeline()));
});

test("snapshots accelerate a long log without changing its meaning", () => {
  const eng = runSkirmish(7, 11);
  eng.snapshotNow();
  const after = eng.state();
  assert.deepEqual(after, fold(eng.store.timeline()));
  // and the export carries no snapshot: the log alone remains the truth
  assert.ok(!eng.store.toJSONL().includes("snapshot"));
});
