/** The character-creation interview: a server-side step machine
 *  (docs/charcreate-box-plan.md §B). Voice-first at the table, chips-first
 *  in mock mode — every step exposes tap chips, and free text goes through
 *  the parser seam: deterministic matching on the Mac/tests, the utility
 *  LLM on the Spark. The machine only shapes a CharacterBuild draft; the
 *  ENGINE remains the legality authority at commit (derive() throws). */

import { SPECIES, CLASSES, BACKGROUNDS, STANDARD_ARRAY, derive,
         type CharacterBuild } from "../../../engine/src/character.js";
import type { Ability } from "../../../engine/src/srd.js";

export type Step = "name" | "species" | "class" | "background"
                 | "abilities" | "bonus" | "skills" | "backstory" | "confirm" | "done";

export interface Chip { id: string; label: string; hint?: string }

export interface InterviewState {
  step: Step;
  prompt: string;             // what Pip asks (the UI voices/shows this)
  chips: Chip[];              // tap fallbacks — the only path in mock media
  expect: "text" | "choice" | "abilities" | "bonus" | "skills" | "confirm";
  draft: Partial<CharacterBuild> & { backstory?: string };
  preview?: ReturnType<typeof derive>; // on confirm step
  error?: string;
}

export type InterviewInput =
  | { text: string }
  | { choice: string }
  | { abilities: Record<Ability, number> }
  | { bonus: Partial<Record<Ability, number>> }
  | { skills: string[] }
  | { confirm: true };

/** Free-text → structured choice. Deterministic on the Mac; LLM on Spark. */
export interface InterviewParser {
  match(step: Step, text: string, chips: Chip[]): string | null; // chip id or null
}

export class DeterministicParser implements InterviewParser {
  match(step: Step, text: string, chips: Chip[]): string | null {
    const t = text.toLowerCase();
    const hit = chips.filter(c =>
      t.includes(c.id.toLowerCase()) || t.includes(c.label.toLowerCase()));
    return hit.length === 1 ? hit[0].id : null;
  }
}

const ABILITY_KEYS: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

export class InterviewSession {
  state: InterviewState;
  private taken: (id: string) => boolean;

  constructor(takenIds: (id: string) => boolean = () => false,
              private parser: InterviewParser = new DeterministicParser()) {
    this.taken = takenIds;
    this.state = this.frame("name", {});
  }

  /** Advance with one input; returns the new state (same step + error on bad input). */
  handle(input: InterviewInput): InterviewState {
    const d = this.state.draft;
    try {
      switch (this.state.step) {
        case "name": {
          let name = (input as any).text?.trim();
          if (!name) return this.again("Say or type a name.");
          // spoken forms: "call me X", "my name is X", "I'm X"
          name = name.replace(/^(call me|my name is|i am|i'm|name's|the name's)\s+/i, "").trim();
          d.name = name;
          d.id = this.freshId(name);
          return this.state = this.frame("species", d);
        }
        case "species": return this.choiceStep(input, "class");
        case "class": return this.choiceStep(input, "background");
        case "background": return this.choiceStep(input, "abilities");
        case "abilities": {
          const a = (input as any).abilities;
          if (!a) return this.again("Assign the six scores (drag the array or say e.g. 'strength 15, dex 14…').");
          const sorted = ABILITY_KEYS.map(k => a[k]).sort((x: number, y: number) => x - y).join();
          if (sorted !== [...STANDARD_ARRAY].sort((x, y) => x - y).join())
            return this.again("That isn't the standard array — use 15, 14, 13, 12, 10, 8 exactly once each.");
          d.abilities = { ...a };
          return this.state = this.frame("bonus", d);
        }
        case "bonus": {
          const choice = "choice" in (input as any) ? (input as any).choice : null;
          const b = choice ? parseBonusChip(choice) : (input as any).bonus;
          if (!b) return this.again("Pick your background bonus: +2/+1 on two of its abilities, or +1 to all three.");
          const allowed = BACKGROUNDS[d.background!].abilities as readonly string[];
          if (Object.keys(b).some(k => !allowed.includes(k)))
            return this.again(`Your background shapes ${allowed.join(", ")} — the bonus goes there.`);
          d.abilityBonus = b;
          return this.state = this.frame("skills", d);
        }
        case "skills": {
          const picked = (input as any).skills;
          const k = CLASSES[d.class!];
          if (!Array.isArray(picked) || picked.length !== k.skillChoices.count)
            return this.again(`Choose exactly ${k.skillChoices.count}.`);
          d.skills = picked;
          return this.state = this.frame("backstory", d);
        }
        case "backstory": {
          const text = (input as any).text?.trim();
          if (!text || text.length < 10)
            return this.again("Give us a little more — who are you, before tonight?");
          d.backstory = text;
          return this.state = this.frame("confirm", d);
        }
        case "confirm": {
          if (!(input as any).confirm) return this.again("Say yes to seal it, or go back.");
          derive(d as CharacterBuild); // the authority — throws on anything illegal
          return this.state = { ...this.frame("done", d), preview: derive(d as CharacterBuild) };
        }
        default:
          return this.again("The character is already sealed.");
      }
    } catch (e) {
      return this.again(String((e as Error).message));
    }
  }

  get done(): boolean { return this.state.step === "done"; }
  get build(): CharacterBuild { return this.state.draft as CharacterBuild; }
  get backstory(): string { return this.state.draft.backstory ?? ""; }

  // ---------------------------------------------------------------- frames
  private choiceStep(input: InterviewInput, next: Step): InterviewState {
    const d = this.state.draft;
    let id = "choice" in (input as any) ? (input as any).choice : null;
    if (!id && "text" in (input as any))
      id = this.parser.match(this.state.step, (input as any).text, this.state.chips);
    if (!id || !this.state.chips.some(c => c.id === id))
      return this.again("I didn't catch that — tap a card or say its name.");
    (d as any)[this.state.step] = id;
    return this.state = this.frame(next, d);
  }

  private frame(step: Step, draft: InterviewState["draft"]): InterviewState {
    const f = (prompt: string, chips: Chip[], expect: InterviewState["expect"]): InterviewState =>
      ({ step, prompt, chips, expect, draft });
    switch (step) {
      case "name":
        return f("Welcome to the table. What is your hero called?", [], "text");
      case "species":
        return f(`Well met, ${draft.name}. What are you?`,
          Object.values(SPECIES).map(s => ({ id: s.id, label: s.name, hint: s.traits.join(", ") })), "choice");
      case "class":
        return f("And what is your calling?",
          Object.values(CLASSES).map(c => ({ id: c.id, label: c.name, hint: `d${c.hitDie}, ${c.saves.join("/")} saves` })), "choice");
      case "background":
        return f("Before the adventure — who were you?",
          Object.values(BACKGROUNDS).map(b => ({ id: b.id, label: b.name, hint: `${b.skills.join(", ")} · +${b.abilities.join("/+")}` })), "choice");
      case "abilities":
        return f("Place your strengths: 15, 14, 13, 12, 10 and 8 — where does each live?",
          ABILITY_KEYS.map(k => ({ id: k, label: k.toUpperCase() })), "abilities");
      case "bonus": {
        const bg = BACKGROUNDS[draft.background!];
        const [a, b, c] = bg.abilities;
        const combos: Chip[] = [
          ...[[a, b], [a, c], [b, a], [b, c], [c, a], [c, b]].map(([x, y]) =>
            ({ id: `${x}+2,${y}+1`, label: `${x.toUpperCase()} +2, ${y.toUpperCase()} +1` })),
          { id: `${a}+1,${b}+1,${c}+1`, label: `+1 to all three` },
        ];
        return f(`Your life as a ${bg.name} hardened you. Where did it show?`, combos, "bonus");
      }
      case "skills": {
        const k = CLASSES[draft.class!];
        const bg = BACKGROUNDS[draft.background!];
        const options = k.skillChoices.from.filter(s => !bg.skills.includes(s));
        return f(`Pick ${k.skillChoices.count} trained skills.`,
          options.map(s => ({ id: s, label: s.replace(/_/g, " ") })), "skills");
      }
      case "backstory":
        return f("Now hold the talk button and tell us your story — a minute is plenty. Who are you, before tonight?", [], "text");
      case "confirm": {
        const st: InterviewState = f("Here is your sheet. Seal it?",
          [{ id: "yes", label: "Seal it" }], "confirm");
        try { st.preview = derive(draft as CharacterBuild); }
        catch (e) { st.error = String((e as Error).message); }
        return st;
      }
      default:
        return f("Your story begins.", [], "confirm");
    }
  }

  private again(error: string): InterviewState {
    return this.state = { ...this.state, error };
  }

  private freshId(name: string): string {
    const base = `pc.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "hero"}`;
    let id = base;
    for (let n = 2; this.taken(id); n++) id = `${base}_${n}`;
    return id;
  }
}

function parseBonusChip(id: string): Partial<Record<Ability, number>> | null {
  const out: Partial<Record<Ability, number>> = {};
  for (const part of id.split(",")) {
    const m = part.trim().match(/^(str|dex|con|int|wis|cha)\+([12])$/);
    if (!m) return null;
    out[m[1] as Ability] = Number(m[2]);
  }
  return Object.keys(out).length ? out : null;
}
