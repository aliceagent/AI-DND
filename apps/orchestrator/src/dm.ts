/** The hub's brain socket. BrainDM wires the real two-tier brain (Spark, or
 *  any HERMYS_LLM_BASE_URL endpoint); EchoDM is the deterministic stand-in
 *  that exercises every table mechanic — checks, the roll pad, reveals —
 *  with zero model, so the voice-loop demo runs on the Mac. */

import { Engine } from "../../../engine/src/engine.js";
import { SKILL_ABILITY, type Ability } from "../../../engine/src/srd.js";
import { SCENES, PRIVATE_RAILS, type DemoScene } from "./scenes.js";

export interface DungeonMaster {
  /** Open the scene; returns Pip's opening narration. */
  openScene(engine: Engine): Promise<string>;
  /** Resolve one declaration (already on the record); returns narration. */
  takeTurn(engine: Engine, decl: { actor: string; text: string }): Promise<string>;
  /** A roll just resolved a pending check; narrate the outcome. */
  afterRoll(engine: Engine, checkId: number): Promise<string>;
}

/** Deterministic mock DM walking a DemoScene's rails the way the Director
 *  will walk pack beats: travel, dialogue (with reveals), a springable
 *  encounter, private rails to the asker alone, keyword → skill checks.
 *  No randomness in the rails: the demo replays byte-identical. */
export class EchoDM implements DungeonMaster {
  constructor(readonly scene: DemoScene =
    SCENES[process.env.HERMYS_SCENE ?? "cellar"] ?? SCENES.cellar) {}

  private goTo(engine: Engine, locId: string): string {
    const loc = this.scene.locations[locId];
    const already = engine.state().scene?.locationId === locId;
    engine.setScene({ id: loc.id, name: loc.name, mood: loc.mood, palette: loc.palette });
    return already ? `You are still at ${loc.name.toLowerCase()}.` : loc.arrival;
  }

  async openScene(engine: Engine): Promise<string> {
    const opening = this.scene.opening;
    if (opening.fact) engine.revealFact(opening.fact.id, "party", opening.fact.text);
    return this.goTo(engine, opening.location);
  }

  async takeTurn(engine: Engine, decl: { actor: string; text: string }): Promise<string> {
    const here = engine.state().scene?.locationId;

    // the encounter rail: real combatants, real initiative
    const enc = this.scene.encounter;
    if (enc && here === enc.at && enc.re.test(decl.text)
        && !engine.state().combatants[`${enc.statblock.ref}.1`]) {
      for (let i = 1; i <= enc.count; i++)
        engine.join(`${enc.statblock.ref}.${i}`, { ...enc.statblock, name: `${enc.statblock.name} ${i}` });
      engine.rollInitiativeAll();
      return enc.announce;
    }

    // private rails: the asker alone learns it (Box-private moment)
    for (const rail of PRIVATE_RAILS[this.scene.id] ?? [])
      if (here === rail.at && rail.re.test(decl.text)) {
        const known = engine.state().facts[rail.id]?.includes(decl.actor);
        if (!known) {
          engine.revealFact(rail.id, [decl.actor], rail.text);
          return "You lean closer. Something here is meant for your eyes first.";
        }
      }

    // dialogue rails (optionally revealing as they speak)
    for (const d of this.scene.dialogue)
      if ((!d.at || d.at === here) && d.re.test(decl.text)) {
        if (d.reveal && !engine.state().facts[d.reveal.id])
          engine.revealFact(d.reveal.id,
            d.reveal.to === "party" ? "party" : [decl.actor], d.reveal.text);
        return d.line;
      }

    // travel rails
    for (const t of this.scene.travel)
      if (t.re.test(decl.text)) return this.goTo(engine, t.to);

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
