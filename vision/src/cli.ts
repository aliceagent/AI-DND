/** Render-plan CLI: pack drafts in → render-plan.json out (gitignored, next
 *  to the drafts). Run it after the Prep Bench review; feed the plan to the
 *  Spark's batch worker overnight.
 *
 *    npm run plan -- [--drafts packs/hotdq/drafts] [--out packs/hotdq/assets]
 *                    [--stars npc.a,npc.b] [--style hermys.ink-and-ember] */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planRenders } from "./plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const draftsDir = flag("--drafts") ?? join(here, "../../packs/hotdq/drafts");
const outDir = flag("--out") ?? join(here, "../../packs/hotdq/assets");
const stars = flag("--stars")?.split(",").map(s => s.trim()).filter(Boolean) ?? [];

const cards = JSON.parse(readFileSync(join(draftsDir, "entities.json"), "utf8"));
const beats = JSON.parse(readFileSync(join(draftsDir, "beats.json"), "utf8"));

const plan = planRenders(cards, beats, { stars, style: flag("--style") });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "render-plan.json"), JSON.stringify(plan, null, 2));

console.log(`✓ render plan → ${join(outDir, "render-plan.json")}`);
console.log(`  ${plan.jobs.length} jobs: ${plan.summary.anchors} anchors, ${plan.summary.variants} state variants`);
console.log(`  priorities: P1 stars ${plan.summary.byPriority[1]}, P2 locations ${plan.summary.byPriority[2]}, P3 rest ${plan.summary.byPriority[3]}`);
console.log(`  LoRA training queue: ${plan.loras.join(", ") || "none"}`);
console.log(`  style: ${plan.style} · seeds deterministic per entity/state (re-runs never invalidate assets)`);
