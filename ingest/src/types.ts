/** Ingestion I/O shapes. Segments are the OWNER-PRODUCED input (sections cut
 *  from the module by hand or a future pdf pass) — they live under packs/
 *  and never enter version control. Drafts are what the passes emit:
 *  schema-valid beats and entity cards, approved:false until a human walks
 *  them on the Prep Bench. Never module text in code or tests — paraphrase. */

export interface Segment {
  id: string;
  episode: string;       // e.g. "e1"
  title: string;
  page: number | string; // source_ref pointer for the Prep Bench
  text: string;          // module prose (pack-private input, paraphrased on output)
  kind?: "scene" | "encounter" | "social" | "reveal" | "clock" | "hub" | "travel" | "duel";
}

export type DraftBeat = Record<string, unknown> & { id: string };
export type DraftEntityCard = Record<string, unknown> & { id: string };

export interface DraftPack {
  beats: DraftBeat[];
  entities: DraftEntityCard[];
  /** stat_refs encountered that the HUMAN must enter by hand — stat blocks
   *  are never parsed blind (mac-week §5). */
  statblocksTodo: string[];
}

export interface Extractor {
  readonly kind: "fixture" | "llm";
  extract(segments: Segment[]): Promise<DraftPack>;
}
