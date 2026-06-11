/** Prep Bench server side: the Bench is a host-role view, so its HTTP
 *  endpoints are gated by a per-process token that ONLY host clients
 *  receive (in their joined message). Drafts come from the pack directory
 *  the ingest CLI writes; the review goes back beside them as
 *  reviewed.json — originals are never overwritten. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface BenchDrafts { beats: any[]; entities: any[] }

export function loadDrafts(dir: string): BenchDrafts {
  const read = (name: string) => {
    const p = join(dir, name);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
  };
  return { beats: read("beats.json"), entities: read("entities.json") };
}

/** Persist the host's review. Validates shape; never pre-approves what the
 *  client didn't explicitly mark. Returns what was written. */
export function saveReviewed(dir: string, payload: unknown): { beats: number; entities: number; approved: number } {
  const p = payload as BenchDrafts;
  if (!p || !Array.isArray(p.beats) || !Array.isArray(p.entities))
    throw new Error("reviewed payload must carry beats[] and entities[]");
  for (const b of p.beats) {
    if (typeof b?.id !== "string") throw new Error("every beat needs an id");
    if (typeof b.approved !== "boolean") throw new Error(`beat ${b.id}: approved must be explicit true/false`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "reviewed.json"), JSON.stringify(p, null, 2));
  return { beats: p.beats.length, entities: p.entities.length,
           approved: p.beats.filter((b: any) => b.approved === true).length };
}

/** Constant-shape token check (the token is per-process and host-only). */
export function benchAuthorized(headerValue: string | string[] | undefined, token: string): boolean {
  return typeof headerValue === "string" && headerValue.length > 0 && headerValue === token;
}
