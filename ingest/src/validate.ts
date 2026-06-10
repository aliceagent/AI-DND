/** Drafts must validate against the contracts before they ever reach the
 *  Prep Bench — a draft that fails the schema is a pipeline bug, not a
 *  reviewer's problem. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { DraftPack } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(readFileSync(join(here, "../../schemas", name), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true });
const validBeat = ajv.compile(load("beat.schema.json"));
const validCard = ajv.compile(load("entity_card.schema.json"));

export interface ValidationReport { ok: boolean; errors: string[] }

export function validateDrafts(pack: DraftPack): ValidationReport {
  const errors: string[] = [];
  for (const b of pack.beats) {
    const id = b.id; // ajv's type guard narrows b inside the branch
    if (!validBeat(b))
      errors.push(...(validBeat.errors ?? []).map(e => `beat ${id}: ${e.instancePath || "/"} ${e.message}`));
  }
  for (const c of pack.entities) {
    const id = c.id;
    if (!validCard(c))
      errors.push(...(validCard.errors ?? []).map(e => `card ${id}: ${e.instancePath || "/"} ${e.message}`));
  }
  // pipeline-level invariants beyond the schemas
  const cardIds = new Set(pack.entities.map(c => c.id));
  for (const b of pack.beats)
    for (const e of (b as any).entities ?? [])
      if (!cardIds.has(e)) errors.push(`beat ${b.id}: references missing card ${e}`);
  for (const b of pack.beats)
    if ((b as any).approved === true)
      errors.push(`beat ${b.id}: drafts must never arrive pre-approved`);
  return { ok: errors.length === 0, errors };
}
