/** The deterministic engine. Commands in → events out → state = fold(events).
 *  Hybrid dice (decision 7): PC rolls arrive as reported values; NPC/secret
 *  rolls are drawn from the seeded RNG and recorded gm-visible.
 *  Monster HP is never public (decision 21): damage to NPCs is gm-visible,
 *  with a public descriptive condition event when the tier changes. */

import { EventStore, type GameEvent, type Visibility } from "./store.js";
import { mulberry32, rollDice, rollD20, type Rng, type Advantage } from "./rng.js";
import { type StatBlock, mod, healthDescriptor } from "./srd.js";
import { fold, type GameState, activeOnSide } from "./state.js";

export class Engine {
  readonly store: EventStore;
  private rng: Rng;

  constructor(seed: number, store = new EventStore()) {
    this.store = store;
    this.rng = mulberry32(seed);
  }

  state(): GameState { return fold(this.store.timeline()); }

  private emit(type: string, visibility: Visibility, payload: Record<string, unknown>,
               actor: string | null = null, causes?: number): GameEvent {
    return this.store.append({ type, visibility, payload, actor, causes });
  }

  // ---------------------------------------------------------------- setup
  join(id: string, sb: StatBlock): void {
    // PC sheet numbers are private to that character (decision 21); NPC
    // join is public by name only — AC/HP live in the gm payload split below.
    const pub = { id, name: sb.name, side: sb.side };
    if (sb.side === "pc") {
      this.emit("combatant_joined", [id], { ...pub, statRef: sb.ref, ac: sb.ac, maxHp: sb.maxHp }, id);
    } else {
      this.emit("combatant_joined", "gm", { ...pub, statRef: sb.ref, ac: sb.ac, maxHp: sb.maxHp });
      this.emit("entity_seen", "public", { id, name: sb.name });
    }
  }

  rollInitiativeAll(stats: Record<string, StatBlock>): void {
    const s = this.state();
    for (const c of Object.values(s.combatants)) {
      const dexMod = mod(stats[c.statRef === c.id ? c.id : c.statRef]?.abilities.dex ?? 10);
      const r = rollD20(this.rng, "none");
      const vis: Visibility = c.side === "pc" ? "public" : "gm";
      this.emit("initiative_rolled", vis, { id: c.id, rolls: r.rolls, total: r.kept + dexMod });
    }
    const s2 = this.state();
    const order = Object.values(s2.combatants)
      .sort((a, b) => (b.initiative! - a.initiative!) || a.id.localeCompare(b.id))
      .map(c => c.id);
    this.emit("combat_started", "public", { order });
  }

  // --------------------------------------------------------------- combat
  /** PC attack: caller supplies the player's reported d20 (and damage roll). */
  pcAttack(attackerId: string, targetId: string, atk: { toHit: number; damage: string },
           reportedD20: number, reportedDamageRolls: number[], advantage: Advantage = "none"): void {
    const decl = this.emit("attack_declared", "public",
      { attacker: attackerId, target: targetId, attack: atk, advantage }, attackerId);
    this.emit("roll_reported", "public",
      { attacker: attackerId, d20: reportedD20, damageRolls: reportedDamageRolls }, attackerId, decl.id);
    this.resolveAttack(decl.id, attackerId, targetId, atk, reportedD20, reportedDamageRolls);
  }

  /** NPC attack: engine draws and records every die. */
  npcAttack(attackerId: string, targetId: string, atk: { toHit: number; damage: string },
            advantage: Advantage = "none"): void {
    const decl = this.emit("attack_declared", "public",
      { attacker: attackerId, target: targetId, attack: { name: atk.damage ? undefined : "" , ...atk }, advantage }, attackerId);
    const d20 = rollD20(this.rng, advantage);
    const dmg = rollDice(atk.damage, this.rng);
    this.emit("engine_rolled", "gm",
      { attacker: attackerId, d20: d20.rolls, kept: d20.kept, damage: dmg }, attackerId, decl.id);
    this.resolveAttack(decl.id, attackerId, targetId, atk, d20.kept,
      dmg.rolls, dmg.modifier);
  }

  private resolveAttack(causeId: number, attackerId: string, targetId: string,
                        atk: { toHit: number; damage: string }, d20: number,
                        damageRolls: number[], damageMod?: number): void {
    const s = this.state();
    const target = s.combatants[targetId];
    const crit = d20 === 20;
    const hit = crit || (d20 !== 1 && d20 + atk.toHit >= target.ac);
    // outcome is public; target AC is not echoed back
    this.emit("attack_resolved", "public",
      { attacker: attackerId, target: targetId, d20, hit, crit }, attackerId, causeId);
    if (!hit) return;

    const m = damageMod ?? parseMod(atk.damage);
    let amount = damageRolls.reduce((a, b) => a + b, 0) + m;
    if (crit) amount += damageRolls.reduce((a, b) => a + b, 0); // simple crit: double dice
    this.applyDamage(targetId, amount, causeId);
  }

  applyDamage(targetId: string, amount: number, causes?: number): void {
    const before = this.state().combatants[targetId];
    const isNpc = before.side === "npc";
    const tierBefore = healthDescriptor(before.hp, before.maxHp);
    // exact numbers: gm-visible for NPCs, private-to-owner for PCs
    this.emit("damage_applied", isNpc ? "gm" : [targetId], { target: targetId, amount }, null, causes);
    const after = this.state().combatants[targetId];
    const tierAfter = healthDescriptor(after.hp, after.maxHp);
    if (tierAfter !== tierBefore)
      this.emit("health_tier_changed", "public", { target: targetId, tier: tierAfter }, null, causes);
    if (after.hp === 0) {
      this.emit("condition_changed", "public",
        { target: targetId, added: isNpc ? "dead" : "unconscious" }, null, causes);
      this.checkCombatEnd();
    }
  }

  advanceTurn(): string | null {
    const s = this.state();
    if (s.combatOver) return null;
    let i = s.turnIndex, round = s.round;
    for (let hop = 0; hop < s.order.length + 1; hop++) {
      i = (i + 1) % s.order.length;
      if (i === 0) round += 1;
      const c = s.combatants[s.order[i]];
      if (!c.conditions.includes("dead") && !c.conditions.includes("unconscious")) {
        this.emit("turn_advanced", "public", { turnIndex: i, round, active: c.id });
        return c.id;
      }
    }
    return null;
  }

  private checkCombatEnd(): void {
    const s = this.state();
    const pcs = activeOnSide(s, "pc").length, npcs = activeOnSide(s, "npc").length;
    if (pcs === 0 || npcs === 0)
      this.emit("combat_ended", "public", { winner: pcs > 0 ? "pc" : "npc" });
  }

  // ------------------------------------------------------------- reveals
  revealFact(factId: string, to: "party" | string[], text: string): void {
    this.emit("fact_revealed", to === "party" ? "public" : to, { factId, to, text });
  }

  // -------------------------------------------------------------- rewind
  rewindTo(eventId: number, branchId: string): void {
    this.store.rebranch(eventId, branchId);
    this.emit("branch_created", "gm", { from: eventId, branch: branchId });
  }
}

function parseMod(expr: string): number {
  const m = expr.replace(/\s/g, "").match(/([+-]\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
