/** Ingestion gates: drafts validate against the beat/entity-card contracts,
 *  secrets land gm_only, nothing arrives pre-approved, stat blocks are
 *  routed to the human, and the CLI writes the pack drafts. The fixture
 *  module is ORIGINAL content — module text never enters tests. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { FixtureExtractor } from "../src/extract.js";
import { validateDrafts } from "../src/validate.js";
import type { Segment } from "../src/types.js";

/** "The Salt Mill" — an invented mini-module for pipeline tests. */
const SEGMENTS: Segment[] = [
  {
    id: "seg.1", episode: "e1", title: "The Salt Mill", page: 7, kind: "scene",
    text: [
      "A squat stone mill leans over the brine channel, its wheel stopped mid-turn.",
      "SECRET: The miller's ledger lists deliveries to a buyer who does not exist.",
      "CHECK(investigation DC 13): Salt dust on the rafters traces a rope path to the loft.",
      "NPC: Old Marta — a stooped miller with brine-cracked hands",
      "EXIT(e1.brine_channel when the party follows the channel)",
    ].join("\n"),
  },
  {
    id: "seg.2", episode: "e1", title: "Brine Channel", page: 9,
    text: [
      "The channel runs black and fast under a plank bridge.",
      "FOES: pack.brine_crawler x1d4+1",
      "SECRET: The crawlers avoid the old sluice gate — something below frightens them.",
      "CLOCK(tide 6)",
      "EXIT(e1.the_salt_mill)",
    ].join("\n"),
  },
];

test("fixture extraction produces schema-valid drafts", async () => {
  const pack = await new FixtureExtractor().extract(SEGMENTS);
  const report = validateDrafts(pack);
  assert.deepEqual(report.errors, []);
  assert.equal(pack.beats.length, 2);
  assert.ok(pack.entities.length >= 3); // two locations + Marta
});

test("secrets land as gm_only facts and on the beat's secret list", async () => {
  const pack = await new FixtureExtractor().extract(SEGMENTS);
  const mill = pack.beats.find(b => b.id === "e1.the_salt_mill") as any;
  assert.equal(mill.secrets.length, 1);
  const millCard = pack.entities.find(c => c.id === "loc.the_salt_mill") as any;
  const secret = millCard.states.default.facts.find((f: any) => f.scope === "gm_only");
  assert.ok(secret.text.includes("ledger"));
  assert.equal(mill.secrets[0], secret.id);
  // and check-gated content is gated, not public
  const gated = millCard.states.default.facts.find((f: any) => f.id.includes("gated"));
  assert.equal(gated.scope, "gated");
});

test("nothing arrives pre-approved; encounter beats carry the 2024 surprise note", async () => {
  const pack = await new FixtureExtractor().extract(SEGMENTS);
  for (const b of pack.beats) assert.equal((b as any).approved, false);
  const channel = pack.beats.find(b => b.id === "e1.brine_channel") as any;
  assert.equal(channel.type, "encounter");
  assert.ok(channel.rules_notes.includes("initiative disadvantage"));
  assert.ok(channel.clock && channel.clock.resource === "tide");
});

test("stat blocks are routed to the human, never extracted", async () => {
  const pack = await new FixtureExtractor().extract(SEGMENTS);
  assert.deepEqual(pack.statblocksTodo, ["pack.brine_crawler"]);
  const all = JSON.stringify(pack.beats) + JSON.stringify(pack.entities);
  assert.ok(!all.match(/"ac"|"maxHp"|"toHit"/), "numeric stats leaked into drafts");
});

test("validation rejects a pre-approved draft and a dangling entity ref", async () => {
  const pack = await new FixtureExtractor().extract(SEGMENTS);
  (pack.beats[0] as any).approved = true;
  (pack.beats[1] as any).entities = ["loc.nowhere"];
  const report = validateDrafts(pack);
  assert.ok(report.errors.some(e => e.includes("pre-approved")));
  assert.ok(report.errors.some(e => e.includes("missing card loc.nowhere")));
});

test("CLI writes drafts + the human statblock template into the pack dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "hermys-ingest-"));
  try {
    const segs = join(dir, "segments.json");
    writeFileSync(segs, JSON.stringify(SEGMENTS));
    const out = join(dir, "drafts");
    execFileSync("npx", ["tsx", "src/cli.ts", segs, "--out", out],
      { cwd: join(import.meta.dirname, ".."), stdio: "pipe" });
    for (const f of ["beats.json", "entities.json", "statblocks.todo.json"])
      assert.ok(existsSync(join(out, f)), `${f} missing`);
    const todo = JSON.parse(readFileSync(join(out, "statblocks.todo.json"), "utf8"));
    assert.equal(todo[0].ref, "pack.brine_crawler");
    assert.equal(todo[0]._human_verified, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
