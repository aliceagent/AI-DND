/** Vision gates: visual fog-of-war by construction. The assembler builds
 *  prompts ONLY from named, current, audience-revealed card states — an
 *  unrevealed ambusher cannot appear because nothing about it exists in the
 *  prompt. The planner enumerates every renderable state deterministically.
 *  Original test content throughout (the Moonlit Cellar, extended). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assembleRender, ManifestRejection, type Card } from "../src/assemble.js";
import { planRenders } from "../src/plan.js";
import { MockAuditor } from "../src/audit.js";

/** The Moonlit Cellar as entity cards — the hidden state carries the
 *  ambush imagery that must never leak. */
const cards = (): Card[] => [
  {
    id: "loc.cellar", kind: "location", pack: "demo",
    names: { canonical: "the counting-house cellar" },
    states: {
      sealed: {
        facts: [{ id: "loc.cellar.look", text: "Dark, cold, mildew and old paper.", scope: "public" }],
        prompt_fragment: "a dark stone cellar, rotting crates, a broken ledger-desk, lantern light pooling on worn flagstones",
      },
      passage_open: {
        facts: [{ id: "loc.cellar.open", text: "The back wall stands open.", scope: "gated" }],
        prompt_fragment: "a stone cellar with a counterweighted wall panel swung open behind a wine rack, a crawlspace beyond",
      },
    },
    current_state: "sealed",
    reveal: { mode: "public_on_sight", revealed_to: "party" },
  },
  {
    id: "npc.veska", kind: "npc", pack: "demo",
    names: { canonical: "Veska Thorn", unrevealed_alias: "the listener behind the wall" },
    states: {
      hidden: {
        facts: [{ id: "npc.veska.hidden", text: "She waits behind the false wall.", scope: "gm_only" }],
        prompt_fragment: "a wiry smuggler crouched in a crawlspace clutching a gilded reliquary case",
      },
    },
    current_state: "hidden",
    reveal: { mode: "event_gated", revealed_to: "none" },
  },
];

const manifest = (over: Record<string, unknown> = {}) => ({
  id: "vm.cellar.establishing",
  beat_id: "beat.cellar_search",
  audience: "shared_screen",
  entities: [{ entity_id: "loc.cellar", state: "sealed", role: "setting" }],
  composition: { framing: "wide establishing", lighting: "single lantern, deep shadows", moment: "the party descends the stairs" },
  audit_negatives: ["a person hiding in a crawlspace", "an open wall panel"],
  priority: "prep",
  ...over,
});

test("a clean manifest assembles: style + revealed fragment + composition, nothing else", () => {
  const r = assembleRender(manifest(), cards());
  assert.ok(r.prompt.includes("rotting crates"));
  assert.ok(r.prompt.includes("wide establishing"));
  assert.ok(r.prompt.includes("dark fantasy illustration"));   // style prefix
  assert.ok(!r.prompt.toLowerCase().includes("smuggler"));     // the hidden card
  assert.ok(!r.prompt.toLowerCase().includes("wall panel"));   // the hidden state
  assert.deepEqual(r.auditNegatives, ["a person hiding in a crawlspace", "an open wall panel"]);
});

test("GATE: an unrevealed entity in a manifest is a hard rejection", () => {
  const m = manifest({ entities: [
    { entity_id: "loc.cellar", state: "sealed", role: "setting" },
    { entity_id: "npc.veska", state: "hidden", role: "subject" },
  ] });
  assert.throws(() => assembleRender(m, cards()), ManifestRejection);
  try { assembleRender(m, cards()); } catch (e) {
    assert.ok((e as ManifestRejection).reasons.some(r => r.includes("not revealed")));
  }
});

test("GATE: a non-current state never renders, even on a revealed card", () => {
  // the passage exists on the revealed cellar card — but it hasn't opened yet
  const m = manifest({ entities: [{ entity_id: "loc.cellar", state: "passage_open", role: "setting" }] });
  assert.throws(() => assembleRender(m, cards()), /not the current state/);
});

test("a reveal transition makes the variant renderable (the game still works)", () => {
  const cs = cards();
  cs[0].current_state = "passage_open"; // the Director transitioned the card
  const m = manifest({ entities: [{ entity_id: "loc.cellar", state: "passage_open", role: "setting" }] });
  const r = assembleRender(m, cs);
  assert.ok(r.prompt.includes("wall panel swung open"));
});

test("partial knowledge never reaches the shared screen; a private vision can", () => {
  const cs = cards();
  cs[0].reveal.revealed_to = ["pc.rogue"]; // only Vex has seen the cellar
  assert.throws(() => assembleRender(manifest(), cs), /not revealed/);
  const priv = manifest({ audience: ["pc.rogue"] });
  assert.ok(assembleRender(priv, cs).prompt.includes("rotting crates"));
  // …but not for a character who wasn't told
  assert.throws(() => assembleRender(manifest({ audience: ["pc.fighter"] }), cs), /not revealed/);
});

test("schema violations and unknown cards reject hard", () => {
  assert.throws(() => assembleRender({ id: "x" }, cards()), ManifestRejection);
  assert.throws(() => assembleRender(manifest({ entities: [{ entity_id: "loc.nowhere", state: "s" }] }), cards()),
    /unknown entity card/);
  assert.throws(() => assembleRender(manifest({ extra_channel: 1 }), cards()), ManifestRejection);
});

test("improv requests get turbo params; prep requests get full quality", () => {
  const prep = assembleRender(manifest(), cards());
  const improv = assembleRender(manifest({ priority: "improv" }), cards());
  assert.ok((improv.params as any).steps < prep.params.steps);
});

test("planner: every renderable state becomes a job — hidden variants included, for prep", () => {
  const plan = planRenders(cards(), []);
  const ids = plan.jobs.map(j => j.id).sort();
  assert.deepEqual(ids, ["loc.cellar/passage_open", "loc.cellar/sealed", "npc.veska/hidden"]);
  const sealed = plan.jobs.find(j => j.id === "loc.cellar/sealed")!;
  const open = plan.jobs.find(j => j.id === "loc.cellar/passage_open")!;
  assert.equal(sealed.kind, "anchor");   // current state
  assert.equal(open.kind, "variant");    // pre-rendered for the reveal moment
  assert.ok(open.prompt.includes("wall panel swung open"));
});

test("planner: deterministic — same input, same plan, stable seeds", () => {
  const a = planRenders(cards(), []);
  const b = planRenders(cards(), []);
  assert.deepEqual(a, b);
  assert.notEqual(a.jobs[0].seed, a.jobs[1].seed);
});

test("planner: stars by recurrence or by name get LoRAs and P1", () => {
  const beats = [1, 2, 3].map(n => ({ id: `b${n}`, entities: ["npc.veska"] })); // 3 appearances
  const plan = planRenders(cards(), beats);
  assert.deepEqual(plan.loras, ["npc.veska"]);
  const veska = plan.jobs.find(j => j.entity_id === "npc.veska")!;
  assert.equal(veska.priority, 1);
  assert.equal(veska.needs_lora, true);
  // explicit nomination works without recurrence
  const named = planRenders(cards(), [], { stars: ["loc.cellar"] });
  assert.ok(named.loras.includes("loc.cellar"));
});

test("audit seatbelt: the mock flags hidden-entity descriptions in a caption", async () => {
  const auditor = new MockAuditor();
  const negatives = ["a person hiding in a crawlspace", "an open wall panel"];
  const bad = await auditor.check("a figure hiding in the crawlspace under the floor", negatives);
  assert.equal(bad.pass, false);
  const good = await auditor.check("an empty stone cellar with crates and a lantern", negatives);
  assert.equal(good.pass, true);
});

test("CLI: drafts in, render-plan.json out", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermys-vision-"));
  try {
    writeFileSync(join(dir, "entities.json"), JSON.stringify(cards()));
    writeFileSync(join(dir, "beats.json"), JSON.stringify([{ id: "b1", entities: ["loc.cellar"] }]));
    execFileSync("npx", ["tsx", "src/cli.ts", "--drafts", dir, "--out", join(dir, "assets")],
      { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
    const plan = JSON.parse(readFileSync(join(dir, "assets/render-plan.json"), "utf8"));
    assert.equal(plan.jobs.length, 3);
    assert.equal(plan.summary.anchors, 2);
    assert.equal(plan.summary.variants, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
