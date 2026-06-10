/** Ingestion CLI: segments in → validated drafts out, into the gitignored
 *  pack directory. Stat blocks come out as a TODO template for the human —
 *  never parsed blind.
 *
 *    npm run ingest -- <segments.json> [--out packs/hotdq/drafts] [--extractor fixture|llm]
 *
 *  The llm extractor needs HERMYS_LLM_BASE_URL/MODEL (the Spark); fixture
 *  is the Mac default and exists to prove the pipeline + feed the Bench. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FixtureExtractor, LlmExtractor } from "./extract.js";
import { validateDrafts } from "./validate.js";
import type { Segment } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const segmentsPath = args.find(a => !a.startsWith("--"));
if (!segmentsPath) {
  console.error("usage: npm run ingest -- <segments.json> [--out dir] [--extractor fixture|llm]");
  process.exit(2);
}
const outDir = flag("--out") ?? join(here, "../../packs/hotdq/drafts");
const kind = flag("--extractor") ?? "fixture";

const segments = JSON.parse(readFileSync(segmentsPath, "utf8")) as Segment[];
const extractor = kind === "llm"
  ? new LlmExtractor(new (await import("../../brain/src/llm.js")).HttpLlm())
  : new FixtureExtractor();

const pack = await extractor.extract(segments);
const report = validateDrafts(pack);
if (!report.ok) {
  console.error(`✗ drafts failed contract validation:\n- ${report.errors.join("\n- ")}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "beats.json"), JSON.stringify(pack.beats, null, 2));
writeFileSync(join(outDir, "entities.json"), JSON.stringify(pack.entities, null, 2));
writeFileSync(join(outDir, "statblocks.todo.json"), JSON.stringify(
  pack.statblocksTodo.map(ref => statblockTemplate(ref)), null, 2));

console.log(`✓ ${pack.beats.length} beats, ${pack.entities.length} cards → ${outDir}`);
console.log(`  ${pack.statblocksTodo.length} stat block(s) await HUMAN entry: ${pack.statblocksTodo.join(", ") || "none"}`);
console.log(`  next: review on the Prep Bench (/bench), approve, then hand-verify statblocks.todo.json`);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Matches engine/src/srd.ts StatBlock — the owner fills every number by
 *  hand from the book, line by line (mac-week §5). */
function statblockTemplate(ref: string) {
  return {
    ref, name: "FILL ME", side: "npc",
    ac: null, maxHp: null,
    abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
    attacks: [{ name: "FILL ME", toHit: null, damage: "XdY+Z", type: "FILL ME", kind: "melee" }],
    proficiency: 2,
    _human_verified: false,
    _source: "enter by hand from the book — never parsed blind",
  };
}
