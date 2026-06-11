/** Gate: scene plumbing. Place is fiction state — scene_set/entity_moved
 *  fold into the state (current scene, visited-fog, entity positions),
 *  replay holds, and visibility behaves (party location public, an unseen
 *  mover gm-side). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { EventStore } from "../src/store.js";
import { fold } from "../src/state.js";
import { PCS } from "../src/srd.js";

test("scene_set folds: current scene + visited order, no duplicates", () => {
  const eng = new Engine(60);
  eng.setScene({ id: "loc.cellar", name: "The Moonlit Cellar", mood: "dread", palette: "night-blues" });
  eng.setScene({ id: "loc.counting_house", name: "The Counting-House Above" });
  eng.setScene({ id: "loc.cellar", name: "The Moonlit Cellar", mood: "dread" });
  const s = eng.state();
  assert.equal(s.scene?.locationId, "loc.cellar");
  assert.equal(s.scene?.mood, "dread");
  assert.deepEqual(s.visitedLocations, ["loc.cellar", "loc.counting_house"]);
});

test("the party's location is public; an unseen mover is not", () => {
  const eng = new Engine(61);
  for (const pc of PCS) eng.join(pc.ref, pc);
  eng.setScene({ id: "loc.cellar", name: "The Moonlit Cellar" });
  eng.moveEntity("npc.lurker", "loc.cellar", "gm");
  const view = eng.store.visibleTo("pc.rogue");
  assert.ok(view.some(e => e.type === "scene_set"));
  assert.ok(!view.some(e => e.type === "entity_moved"), "the lurker's arrival leaked");
  assert.equal(eng.state().entityLocations["npc.lurker"], "loc.cellar"); // gm truth has it
});

test("replay carries the scene", () => {
  const eng = new Engine(62);
  eng.setScene({ id: "loc.cellar", name: "The Moonlit Cellar", palette: "night-blues" });
  eng.moveEntity("pc.rogue", "loc.cellar");
  const replayed = fold(EventStore.fromJSONL(eng.store.toJSONL()).timeline());
  assert.deepEqual(replayed, eng.state());
});
