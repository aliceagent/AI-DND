/** Manifest → prompt assembly: THE image-path safety boundary (invariant 5,
 *  build plan §1.5). Prompts are concatenated EXCLUSIVELY from the named
 *  state's prompt_fragment on each referenced entity card, plus composition
 *  notes and the style preset. Module text is structurally absent — it
 *  never had a way in. Like the Narration Brief gate, rejection is hard and
 *  carries no override parameter:
 *    - the manifest must validate against visible_manifest.schema.json;
 *    - every referenced card must exist and carry the named state;
 *    - the named state must BE the card's current state;
 *    - the card must be revealed to the manifest's audience — an unrevealed
 *      ambusher cannot appear in the image because nothing about it exists
 *      in the prompt. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { preset, type StylePreset } from "./style.js";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "../../schemas/visible_manifest.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: true });
const validManifest = ajv.compile(schema);

export type Card = Record<string, any> & { id: string };
export type Manifest = Record<string, any> & { id: string };

export class ManifestRejection extends Error {
  constructor(public reasons: string[]) {
    super(`Visible Manifest rejected:\n- ${reasons.join("\n- ")}`);
    this.name = "ManifestRejection";
  }
}

export interface RenderRequest {
  manifestId: string;
  prompt: string;
  negative: string;
  params: StylePreset["params"] | (StylePreset["params"] & StylePreset["improvParams"]);
  loras: string[];
  anchors: string[];          // conditioning references for recurring stars
  auditNegatives: string[];   // the VLM seatbelt's assertion list (improv only)
}

const ROLE_ORDER: Record<string, number> = { setting: 0, subject: 1, background: 2 };

export function assembleRender(manifest: unknown, cards: Card[], styleId?: string): RenderRequest {
  const reasons: string[] = [];
  const m = structuredClone(manifest) as Manifest;

  if (!validManifest(m))
    throw new ManifestRejection((validManifest.errors ?? [])
      .map(e => `schema: ${e.instancePath || "/"} ${e.message}`));

  const byId = new Map(cards.map(c => [c.id, c]));
  const fragments: { role: string; text: string }[] = [];
  const loras: string[] = [];
  const anchors: string[] = [];

  for (const ref of m.entities as any[]) {
    const card = byId.get(ref.entity_id);
    if (!card) { reasons.push(`unknown entity card: ${ref.entity_id}`); continue; }
    const state = card.states?.[ref.state];
    if (!state) { reasons.push(`${ref.entity_id}: no such state "${ref.state}"`); continue; }
    if (card.current_state !== ref.state)
      reasons.push(`${ref.entity_id}: state "${ref.state}" is not the current state ("${card.current_state}")`);
    if (!audienceMaySee(card, m.audience))
      reasons.push(`${ref.entity_id}: not revealed to this audience`);
    if (!state.prompt_fragment)
      reasons.push(`${ref.entity_id}/${ref.state}: state has no prompt_fragment`);
    if (reasons.length) continue;
    fragments.push({ role: ref.role ?? "subject", text: state.prompt_fragment });
    if (ref.lora_ref ?? state.lora_ref) loras.push(ref.lora_ref ?? state.lora_ref);
    if (ref.anchor_asset ?? state.anchor_asset) anchors.push(ref.anchor_asset ?? state.anchor_asset);
  }
  if (reasons.length) throw new ManifestRejection(reasons);

  const style = preset(m.style_preset ?? styleId);
  const comp = m.composition ?? {};
  const parts = [
    style.prefix,
    ...fragments.sort((a, b) => (ROLE_ORDER[a.role] ?? 1) - (ROLE_ORDER[b.role] ?? 1)).map(f => f.text),
    comp.moment, comp.framing, comp.lighting,
  ].filter(Boolean);

  return {
    manifestId: m.id,
    prompt: parts.join(" ").replace(/\s+/g, " ").trim() + style.suffix,
    negative: style.negative,
    params: m.priority === "improv" ? { ...style.params, ...style.improvParams } : style.params,
    loras,
    anchors,
    auditNegatives: (m.audit_negatives ?? []) as string[],
  };
}

/** Reveal gate. shared_screen ⇒ the whole party must know it; a private
 *  vision ⇒ every targeted character must know it. "none" never renders. */
function audienceMaySee(card: Card, audience: "shared_screen" | string[]): boolean {
  const r = card.reveal?.revealed_to ?? "none";
  if (r === "party") return true;
  if (r === "none" || !Array.isArray(r)) return false;
  if (audience === "shared_screen") return false; // partial knowledge never hits the shared screen
  return audience.every(ch => r.includes(ch));
}
