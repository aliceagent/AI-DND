/** Gate: the 2024 surprise rule. Surprised combatants roll initiative with
 *  disadvantage — recorded on the event — and nobody ever loses a round. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scene, STATS } from "./helpers.js";
import { PCS, mod } from "../src/srd.js";

test("surprised combatants roll initiative at disadvantage", () => {
  const eng = scene(7, undefined, 3);
  const surprised = PCS.map(pc => pc.ref);
  eng.rollInitiativeAll(STATS, surprised);

  for (const e of eng.store.timeline().filter(e => e.type === "initiative_rolled")) {
    const p = e.payload as any;
    if (surprised.includes(p.id)) {
      assert.equal(p.advantage, "dis");
      assert.equal(p.surprised, true);
      assert.equal(p.rolls.length, 2);                       // two dice drawn,
      const dex = mod(STATS[p.id].abilities.dex);            // the lower kept
      assert.equal(p.total, Math.min(...p.rolls) + dex);
    } else {
      assert.equal(p.rolls.length, 1);
      assert.equal(p.advantage, undefined);
    }
  }
});

test("nobody loses a round: every combatant is in the initiative order", () => {
  const eng = scene(11, undefined, 3);
  eng.rollInitiativeAll(STATS, PCS.map(pc => pc.ref));
  const order = (eng.store.timeline().find(e => e.type === "combat_started")!.payload as any).order;
  assert.equal(order.length, PCS.length + 3);
  for (const pc of PCS) assert.ok(order.includes(pc.ref), `${pc.ref} missing from the round`);
});

test("surprise is deterministic from the seed", () => {
  const run = () => {
    const eng = scene(123, undefined, 2);
    eng.rollInitiativeAll(STATS, ["pc.rogue", "kobold.1"]);
    return eng.store.toJSONL();
  };
  assert.equal(run(), run());
});
