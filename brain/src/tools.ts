/** The engine command API wrapped as an OpenAI tool schema — the Director's
 *  only hands. LLMs never track state (invariant 1): every mutation goes
 *  through these tools, every tool appends visibility-tagged events.
 *  send_narration_brief is the terminal tool: the loop intercepts it and
 *  hands the brief to the context assembler for validation. */

import { Engine } from "../../engine/src/engine.js";
import type { Ability } from "../../engine/src/srd.js";
import type { Advantage } from "../../engine/src/rng.js";

const ABILITY = { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] };
const ADVANTAGE = { type: "string", enum: ["none", "adv", "dis"] };

export const SEND_BRIEF = "send_narration_brief";

export const DIRECTOR_TOOLS = [
  tool("call_check",
    "Call a check or saving throw on a PC. The player rolls physical dice; the table is told the ability/skill but NEVER the DC. Returns a checkId to match the reported roll.",
    { actor: { type: "string" }, kind: { type: "string", enum: ["check", "save"] },
      ability: ABILITY, skill: { type: ["string", "null"] },
      dc: { type: "integer" }, advantage: ADVANTAGE },
    ["actor", "kind", "ability", "dc"]),
  tool("engine_check",
    "Secret check or save for an NPC (or a hidden roll). The engine draws the dice; nothing is shown to players.",
    { actor: { type: "string" }, kind: { type: "string", enum: ["check", "save"] },
      ability: ABILITY, skill: { type: ["string", "null"] },
      dc: { type: "integer" }, advantage: ADVANTAGE },
    ["actor", "kind", "ability", "dc"]),
  tool("passive_check",
    "Consult a PC's passive skill score against a DC. Entirely invisible to the player.",
    { actor: { type: "string" }, skill: { type: "string" }, dc: { type: "integer" } },
    ["actor", "skill", "dc"]),
  tool("npc_attack",
    "An NPC attacks. The engine rolls and resolves; condition effects apply automatically.",
    { attacker: { type: "string" }, target: { type: "string" },
      to_hit: { type: "integer" }, damage: { type: "string", description: "dice expr, e.g. 1d4+2" },
      attack_kind: { type: "string", enum: ["melee", "ranged"] }, advantage: ADVANTAGE },
    ["attacker", "target", "to_hit", "damage"]),
  tool("apply_damage",
    "Apply damage outside an attack roll (traps, falls, ongoing effects).",
    { target: { type: "string" }, amount: { type: "integer" } }, ["target", "amount"]),
  tool("apply_healing",
    "Apply healing to a combatant.",
    { target: { type: "string" }, amount: { type: "integer" } }, ["target", "amount"]),
  tool("set_condition",
    "Add or remove a condition (prone, restrained, frightened, …).",
    { target: { type: "string" }, add: { type: "string" }, remove: { type: "string" } },
    ["target"]),
  tool("cast_spell",
    "Spend a spell slot. Fails if the caster has none left — the engine is the bookkeeper.",
    { caster: { type: "string" }, level: { type: "integer" } }, ["caster", "level"]),
  tool("rest",
    "Take a short or long rest for the listed participants.",
    { type: { type: "string", enum: ["short", "long"] },
      participants: { type: "array", items: { type: "string" } } },
    ["type", "participants"]),
  tool("roll_initiative",
    "Roll initiative for everyone in the scene. Surprised combatants roll at disadvantage (2024 rule) — nobody loses a round.",
    { surprised: { type: "array", items: { type: "string" } } }, []),
  tool("advance_turn",
    "Advance to the next living combatant's turn.", {}, []),
  tool("reveal_fact",
    "Reveal a pack fact to the party or to specific characters. This is the ONLY way knowledge becomes narratable.",
    { fact_id: { type: "string" },
      to: { oneOf: [{ type: "string", enum: ["party"] }, { type: "array", items: { type: "string" } }] },
      text: { type: "string" } },
    ["fact_id", "to", "text"]),
  tool("query_state",
    "Read the full current game state (GM view).", {}, []),
  tool(SEND_BRIEF,
    "End your turn by sending the Narration Brief for Pip. Only revealed facts, sanctioned hints, and negative constraints — never a DC, never a gm-only fact id.",
    { brief: { type: "object", description: "A NarrationBrief per schemas/narration_brief.schema.json" } },
    ["brief"]),
] as const;

function tool(name: string, description: string,
              properties: Record<string, unknown>, required: string[]) {
  return { type: "function" as const,
    function: { name, description,
      parameters: { type: "object", properties, required, additionalProperties: false } } };
}

/** Execute a Director tool call against the engine. Returns a JSON string
 *  the model can read back. Engine throws surface as error strings — the
 *  Director learns and retries; the engine never bends. */
export function executeTool(engine: Engine, name: string, argsJson: string): string {
  const a = argsJson.trim() ? JSON.parse(argsJson) : {};
  try {
    switch (name) {
      case "call_check": {
        const checkId = engine.callCheck({ actor: a.actor, kind: a.kind, ability: a.ability as Ability,
          skill: a.skill ?? null, dc: a.dc, dcVisibility: "gm", advantage: (a.advantage ?? "none") as Advantage });
        return JSON.stringify({ checkId, status: "awaiting_player_roll" });
      }
      case "engine_check": {
        const r = engine.engineCheck({ actor: a.actor, kind: a.kind, ability: a.ability as Ability,
          skill: a.skill ?? null, dc: a.dc, advantage: (a.advantage ?? "none") as Advantage });
        return JSON.stringify(r);
      }
      case "passive_check":
        return JSON.stringify(engine.passiveCheck(a.actor, a.skill, a.dc));
      case "npc_attack":
        engine.npcAttack(a.attacker, a.target,
          { toHit: a.to_hit, damage: a.damage, kind: a.attack_kind ?? "melee" },
          (a.advantage ?? "none") as Advantage);
        return lastEventsSummary(engine, 4);
      case "apply_damage":
        engine.applyDamage(a.target, a.amount);
        return lastEventsSummary(engine, 3);
      case "apply_healing":
        engine.applyHealing(a.target, a.amount);
        return lastEventsSummary(engine, 3);
      case "set_condition":
        engine.setCondition(a.target, { add: a.add, remove: a.remove });
        return JSON.stringify({ ok: true });
      case "cast_spell":
        engine.castSpell(a.caster, a.level);
        return JSON.stringify({ ok: true });
      case "rest":
        engine.rest(a.type, a.participants);
        return JSON.stringify({ ok: true });
      case "roll_initiative":
        engine.rollInitiativeAll({}, a.surprised ?? []);
        return JSON.stringify({ order: engine.state().order });
      case "advance_turn":
        return JSON.stringify({ active: engine.advanceTurn() });
      case "reveal_fact":
        engine.revealFact(a.fact_id, a.to, a.text);
        return JSON.stringify({ ok: true });
      case "query_state":
        return JSON.stringify(engine.state());
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: String((e as Error).message ?? e) });
  }
}

function lastEventsSummary(engine: Engine, n: number): string {
  const tail = engine.store.timeline().slice(-n)
    .map(e => ({ type: e.type, payload: e.payload }));
  return JSON.stringify(tail);
}
