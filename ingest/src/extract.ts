/** Extraction passes. The LLM pass (Spark) and the fixture pass (Mac, tests)
 *  implement one interface, so the pipeline shape is proven now and the
 *  model is a config swap later. Both emit ORIGINAL paraphrase — segment
 *  prose goes in, structured facts come out; boxed text never flows through
 *  to drafts (it stays in the pack as Narrator-speakable seeds, a later
 *  pass). Stat blocks are never extracted at all: any stat_ref the passes
 *  notice lands on the human's todo list. */

import type { LlmClient } from "../../brain/src/llm.js";
import type { Segment, DraftPack, DraftBeat, DraftEntityCard, Extractor } from "./types.js";

// --------------------------------------------------------------- fixture
/** Deterministic, model-free pass: enough structure detection to prove the
 *  pipeline and drive the Prep Bench with real shapes. Conventions it
 *  understands in segment text (the owner's segmentation step adds them):
 *    "SECRET: <text>"         → gm_only fact on the segment's location card
 *    "CHECK(skill DC n): …"   → check_gated fact
 *    "NPC: <Name> — <desc>"   → npc card with unrevealed alias
 *    "FOES: <ref> x<expr>"    → encounter group + statblock todo
 *    "CLOCK(resource start)"  → clock skeleton
 *    "EXIT(beat-id when …)"   → exit edge */
export class FixtureExtractor implements Extractor {
  readonly kind = "fixture" as const;

  async extract(segments: Segment[]): Promise<DraftPack> {
    const beats: DraftBeat[] = [];
    const entities: DraftEntityCard[] = [];
    const statblocksTodo = new Set<string>();

    for (const seg of segments) {
      const locId = `loc.${slug(seg.title)}`;
      const secrets: string[] = [];
      const facts: any[] = [{
        id: `${locId}.appearance`,
        text: firstSentence(seg.text),
        scope: "public", renderable: true,
      }];

      for (const m of seg.text.matchAll(/SECRET:\s*([^\n]+)/g)) {
        const fid = `${locId}.secret.${secrets.length + 1}`;
        secrets.push(fid);
        facts.push({ id: fid, text: m[1].trim(), scope: "gm_only" });
      }
      for (const m of seg.text.matchAll(/CHECK\((\w+)\s+DC\s*(\d+)\):\s*([^\n]+)/g))
        facts.push({ id: `${locId}.gated.${m[1]}`, text: m[3].trim(), scope: "gated" });

      entities.push({
        id: locId, kind: "location",
        pack: "hotdq",
        names: { canonical: seg.title },
        states: { default: { facts, prompt_fragment: firstSentence(seg.text) } },
        current_state: "default",
        reveal: { mode: "public_on_sight", revealed_to: "none" },
        source_ref: `p.${seg.page}`,
      });

      const beatEntities = [locId];
      for (const m of seg.text.matchAll(/NPC:\s*([A-Z][\w' -]+)\s*—\s*([^\n]+)/g)) {
        const npcId = `npc.${slug(m[1])}`;
        beatEntities.push(npcId);
        entities.push({
          id: npcId, kind: "npc",
          pack: "hotdq",
          names: { canonical: m[1].trim(), unrevealed_alias: aliasFor(m[2]) },
          states: { default: { facts: [{ id: `${npcId}.first_impression`, text: m[2].trim(), scope: "public" }] } },
          current_state: "default",
          reveal: { mode: "public_on_sight", revealed_to: "none" },
          source_ref: `p.${seg.page}`,
        });
      }

      const groups: any[] = [];
      for (const m of seg.text.matchAll(/FOES:\s*([\w.]+)\s*x\s*([^\n]+)/g)) {
        groups.push({ stat_ref: m[1], count_expr: m[2].trim() });
        statblocksTodo.add(m[1]);
      }

      const clockM = seg.text.match(/CLOCK\((\w+)\s+(\d+)\)/);
      const exits: any[] = [];
      for (const m of seg.text.matchAll(/EXIT\(([\w.-]+)(?:\s+when\s+([^)]+))?\)/g))
        exits.push({ to: m[1], condition: m[2]?.trim() ?? null, kind: "free" });
      if (!exits.length) exits.push({ to: "adhoc.unplanned", condition: null, kind: "free" });

      beats.push({
        id: `${seg.episode}.${slug(seg.title)}`,
        episode: seg.episode,
        type: seg.kind ?? (groups.length ? "encounter" : "scene"),
        entities: beatEntities,
        secrets,
        ...(groups.length ? { encounter: { groups } } : {}),
        ...(clockM ? { clock: { resource: clockM[1], start: Number(clockM[2]), thresholds: [] } } : {}),
        exits,
        rules_notes: groups.length ? "2024 surprise: initiative disadvantage, never a lost round." : "",
        source_ref: `p.${seg.page}`,
        approved: false,
      });
    }
    return { beats, entities, statblocksTodo: [...statblocksTodo].sort() };
  }
}

// ------------------------------------------------------------------- llm
const BEAT_PROMPT = `You convert one module section into a draft Beat JSON object for a game engine. Output ONLY JSON. Use ORIGINAL paraphrase — never copy sentences from the source. Schema hints: { id, episode, type: scene|encounter|social|reveal|clock|hub|travel|duel, entities: [card ids], secrets: [fact ids hidden at entry], encounter: {groups:[{stat_ref, count_expr}]} | null, exits: [{to, condition, kind}], rules_notes, source_ref, approved: false }`;

const ENTITY_PROMPT = `You convert one module section into draft EntityCard JSON objects (locations, NPCs, creatures, objects). Output ONLY a JSON array. Facts are atomic, individually revealable, ORIGINAL paraphrase. Secrets become facts with scope "gm_only"; check-discoverable details get scope "gated". Never copy module sentences; never include stat blocks (reference stat_ref ids instead).`;

export class LlmExtractor implements Extractor {
  readonly kind = "llm" as const;
  constructor(private llm: LlmClient) {}

  async extract(segments: Segment[]): Promise<DraftPack> {
    const beats: DraftBeat[] = [];
    const entities: DraftEntityCard[] = [];
    const statblocksTodo = new Set<string>();
    for (const seg of segments) {
      const beat = await this.json(BEAT_PROMPT, seg);
      if (beat && typeof beat === "object")
        beats.push({ approved: false, ...(beat as Record<string, unknown>) } as unknown as DraftBeat);
      const cards = await this.json(ENTITY_PROMPT, seg);
      if (Array.isArray(cards)) entities.push(...cards);
      for (const g of (beats.at(-1) as any)?.encounter?.groups ?? [])
        if (g?.stat_ref) statblocksTodo.add(g.stat_ref);
    }
    return { beats, entities, statblocksTodo: [...statblocksTodo].sort() };
  }

  private async json(system: string, seg: Segment): Promise<unknown> {
    const res = await this.llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `episode: ${seg.episode}\ntitle: ${seg.title}\nsource_ref: p.${seg.page}\n\n${seg.text}` },
      ],
      temperature: 0,
    });
    const text = res.content ?? "";
    const start = Math.min(...["{", "["].map(c => text.indexOf(c)).filter(i => i >= 0));
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (!isFinite(start) || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

// --------------------------------------------------------------- helpers
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const firstSentence = (s: string) => (s.replace(/\s+/g, " ").match(/^.*?[.!?]/)?.[0] ?? s.slice(0, 120)).trim();
const aliasFor = (desc: string) => `the ${(desc.match(/\b(\w+ \w+)$/)?.[1] ?? "stranger").toLowerCase()}`;
