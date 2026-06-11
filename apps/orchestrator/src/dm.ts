/** The hub's brain socket. BrainDM wires the real two-tier brain (Spark, or
 *  any HERMYS_LLM_BASE_URL endpoint); EchoDM is the deterministic stand-in
 *  that exercises every table mechanic — checks, the roll pad, reveals —
 *  with zero model, so the voice-loop demo runs on the Mac. */

import { Engine } from "../../../engine/src/engine.js";
import { SKILL_ABILITY, type Ability } from "../../../engine/src/srd.js";

export interface DungeonMaster {
  /** Open the scene; returns Pip's opening narration. */
  openScene(engine: Engine): Promise<string>;
  /** Resolve one declaration (already on the record); returns narration. */
  takeTurn(engine: Engine, decl: { actor: string; text: string }): Promise<string>;
  /** A roll just resolved a pending check; narrate the outcome. */
  afterRoll(engine: Engine, checkId: number): Promise<string>;
}

/** Deterministic mock DM. Keyword → skill check (hidden DC, real engine
 *  flow); anything else gets templated acknowledgement. No randomness:
 *  the demo replays byte-identical. */
export class EchoDM implements DungeonMaster {
  async openScene(engine: Engine): Promise<string> {
    engine.setScene({ id: "loc.cellar", name: "The Moonlit Cellar",
      mood: "dread", palette: "night-blues" });
    engine.revealFact("fact.cellar_dark", "party",
      "The cellar is dark, cold, and smells of mildew and old paper.");
    return "The hatch creaks open onto darkness. Cold air rises, thick with mildew and old paper. Your lantern pushes a small circle of light down worn stone steps.";
  }

  async takeTurn(engine: Engine, decl: { actor: string; text: string }): Promise<string> {
    // travel: the demo's second node — a new scene is an establishing moment
    if (/upstairs|outside|leave|back up|counting.house/i.test(decl.text)) {
      const already = engine.state().scene?.locationId === "loc.counting_house";
      engine.setScene({ id: "loc.counting_house", name: "The Counting-House Above",
        mood: "wary-quiet", palette: "lamp-gold" });
      return already
        ? "You are already among the desks and dust above."
        : "You climb back into the counting-house: overturned desks, scattered ledgers, moonlight through a broken shutter.";
    }
    if (/cellar|downstairs|back down/i.test(decl.text)) {
      engine.setScene({ id: "loc.cellar", name: "The Moonlit Cellar",
        mood: "dread", palette: "night-blues" });
      return "Down the worn steps again; the dark accepts you back.";
    }
    const skill = matchSkill(decl.text);
    if (skill) {
      const ability = SKILL_ABILITY[skill] as Ability;
      engine.callCheck({ actor: decl.actor, kind: "check", ability, skill, dc: 12 });
      const name = engine.state().combatants[decl.actor]?.name ?? decl.actor;
      return `${name}, that calls for a ${cap(skill.replace(/_/g, " "))} check — roll for me.`;
    }
    return `You ${trimEnd(decl.text)}. The dark holds its breath around you.`;
  }

  async afterRoll(engine: Engine, checkId: number): Promise<string> {
    const resolved = engine.store.timeline().find(e =>
      e.type === "check_resolved" && e.visibility === "public" &&
      (e.payload as any).checkId === checkId);
    const p = resolved?.payload as any;
    if (!p) return "The moment passes.";
    return p.outcome === "success"
      ? "Your instincts reward you — something here is not as it first appeared."
      : "Nothing. Shadows, dust, and your own breathing.";
  }
}

const SKILL_HINTS: [RegExp, string][] = [
  [/search|investigat|examine|inspect/i, "investigation"],
  [/look|spot|watch|scan|listen/i, "perception"],
  [/sneak|hide|quiet/i, "stealth"],
  [/climb|lift|shove|force|push/i, "athletics"],
  [/recall|lore|history/i, "history"],
  [/sense motive|read (him|her|them)|insight/i, "insight"],
];

function matchSkill(text: string): string | null {
  for (const [re, skill] of SKILL_HINTS) if (re.test(text)) return skill;
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimEnd = (s: string) => s.replace(/[.!?\s]+$/, "");

/** The real thing: wraps the Phase 2 brain. Constructed only when an LLM
 *  endpoint is configured (the Spark, or any OpenAI-compatible server). */
export class BrainDM implements DungeonMaster {
  private brain: Promise<typeof import("../../../brain/src/session.js")> | null = null;
  private llm: import("../../../brain/src/llm.js").LlmClient | null = null;
  private pack: import("../../../brain/src/scene.js").ScenePack | null = null;

  private async deps() {
    if (!this.brain) this.brain = import("../../../brain/src/session.js");
    const session = await this.brain;
    if (!this.llm) {
      const { HttpLlm } = await import("../../../brain/src/llm.js");
      this.llm = new HttpLlm();
    }
    if (!this.pack) {
      const { MOONLIT_CELLAR } = await import("../../../brain/src/scene.js");
      this.pack = MOONLIT_CELLAR;
    }
    return { session, llm: this.llm!, pack: this.pack! };
  }

  async openScene(engine: Engine): Promise<string> {
    const { session, llm, pack } = await this.deps();
    return (await session.playTurn(llm, engine, pack, null)).narration;
  }

  async takeTurn(engine: Engine, decl: { actor: string; text: string }): Promise<string> {
    const { session, llm, pack } = await this.deps();
    // the hub already put the declaration on the record
    return (await session.playTurn(llm, engine, pack, decl, { recordDeclaration: false })).narration;
  }

  async afterRoll(engine: Engine, checkId: number): Promise<string> {
    const { session, llm, pack } = await this.deps();
    return (await session.playTurn(llm, engine, pack,
      { actor: "table", text: `(roll reported for check #${checkId})` },
      { recordDeclaration: false })).narration;
  }
}

export function createDM(kind = process.env.HERMYS_DM ?? "echo"): DungeonMaster {
  switch (kind) {
    case "echo": return new EchoDM();
    case "brain": return new BrainDM();
    default: throw new Error(`unknown HERMYS_DM: ${kind}`);
  }
}
