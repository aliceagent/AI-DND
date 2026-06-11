/** The deterministic engine. Commands in → events out → state = fold(events).
 *  Hybrid dice (decision 7): PC rolls arrive as reported values; NPC/secret
 *  rolls are drawn from the seeded RNG and recorded gm-visible.
 *  Monster HP is never public (decision 21): damage to NPCs is gm-visible,
 *  with a public descriptive condition event when the tier changes.
 *
 *  Hidden-DC check flow (schemas/event.schema.json):
 *    check_called (public, no DC; modifier included for the roll pad)
 *      + check_called companion (gm) committing the DC before any roll
 *    → roll_reported (public, player's dice)
 *    → check_resolved (gm, full numbers incl. DC) + check_resolved twin
 *      (public, outcome without the DC). A player view never contains a DC. */

import { EventStore, type IEventStore, type GameEvent, type Visibility } from "./store.js";
import { mulberry32, rollDice, rollD20, type Rng, type Advantage } from "./rng.js";
import { type StatBlock, type Ability, SKILL_ABILITY, mod, checkModifier, saveModifier, healthDescriptor } from "./srd.js";
import { type CharacterBuild, derive, deriveLevelUp } from "./character.js";
import { fold, type GameState, type PendingCheck, activeOnSide } from "./state.js";
import { combineAdvantage, attackFactors, autoCrit, saveFactors, autoFailsSave, checkFactors, type AttackKind } from "./conditions.js";

export interface CheckCall {
  actor: string;
  kind: "check" | "save";
  ability: Ability;
  skill?: string | null;
  dc: number;
  dcVisibility?: "public" | "gm";
  advantage?: Advantage;
  /** Mechanical follow-up marker (e.g. {kind:"concentration"}) — public,
   *  carried on the pending check; the resolver acts on it. */
  purpose?: Record<string, unknown>;
}

export class Engine {
  readonly store: IEventStore;
  private rng: Rng;
  private stats = new Map<string, StatBlock>(); // by combatant id, set at join

  constructor(seed: number, store: IEventStore = new EventStore()) {
    this.store = store;
    this.rng = mulberry32(seed);
  }

  state(): GameState {
    const tl = this.store.timeline();
    const snap = this.store.nearestSnapshot(tl);
    if (!snap) return fold(tl);
    return fold(tl.filter(e => e.id > snap.eventId), snap.state as GameState);
  }

  /** Cache the current state against the tip event id; long campaigns fold
   *  from here instead of event 1. Rewinds past it invalidate it naturally. */
  snapshotNow(): number | null {
    const tl = this.store.timeline();
    if (!tl.length) return null;
    const tip = tl[tl.length - 1].id;
    this.store.saveSnapshot(tip, this.state());
    return tip;
  }

  private emit(type: string, visibility: Visibility, payload: Record<string, unknown>,
               actor: string | null = null, causes?: number): GameEvent {
    return this.store.append({ type, visibility, payload, actor,
      ...(causes !== undefined ? { causes } : {}) });
  }

  private statFor(id: string): StatBlock {
    const sb = this.stats.get(id);
    if (!sb) throw new Error(`unknown combatant: ${id}`);
    return sb;
  }

  // ---------------------------------------------------------------- setup
  join(id: string, sb: StatBlock): void {
    this.stats.set(id, sb);
    // PC sheet numbers are private to that character (decision 21); NPC
    // join is public by name only — AC/HP live in the gm payload split below.
    const pub = { id, name: sb.name, side: sb.side };
    const sheet = { statRef: sb.ref, ac: sb.ac, maxHp: sb.maxHp,
                    ...(sb.slots ? { slots: sb.slots } : {}),
                    ...(sb.hitDice ? { hitDice: sb.hitDice } : {}) };
    if (sb.side === "pc") {
      this.emit("combatant_joined", [id], { ...pub, ...sheet }, id);
    } else {
      this.emit("combatant_joined", "gm", { ...pub, ...sheet });
      this.emit("entity_seen", "public", { id, name: sb.name });
    }
  }

  /** 2024 surprise rule: surprised combatants roll initiative with
   *  disadvantage — nobody ever loses a round. */
  rollInitiativeAll(stats: Record<string, StatBlock> = {}, surprised: string[] = []): void {
    const s = this.state();
    for (const c of Object.values(s.combatants)) {
      const sb = stats[c.statRef] ?? this.stats.get(c.id);
      const dexMod = mod(sb?.abilities.dex ?? 10);
      const isSurprised = surprised.includes(c.id);
      const r = rollD20(this.rng, isSurprised ? "dis" : "none");
      const vis: Visibility = c.side === "pc" ? "public" : "gm";
      this.emit("initiative_rolled", vis,
        isSurprised
          ? { id: c.id, rolls: r.rolls, total: r.kept + dexMod, advantage: "dis", surprised: true }
          : { id: c.id, rolls: r.rolls, total: r.kept + dexMod });
    }
    const s2 = this.state();
    const order = Object.values(s2.combatants)
      .sort((a, b) => (b.initiative! - a.initiative!) || a.id.localeCompare(b.id))
      .map(c => c.id);
    this.emit("combat_started", "public", { order });
  }

  // --------------------------------------------------------------- combat
  /** PC attack: caller supplies the player's reported d20 (and damage roll). */
  pcAttack(attackerId: string, targetId: string, atk: { toHit: number; damage: string; kind?: AttackKind },
           reportedD20: number, reportedDamageRolls: number[], advantage: Advantage = "none"): void {
    const decl = this.declareAttack(attackerId, targetId, atk, advantage);
    this.emit("roll_reported", "public",
      { attacker: attackerId, d20: reportedD20, damageRolls: reportedDamageRolls }, attackerId, decl.id);
    this.resolveAttack(decl.id, attackerId, targetId, atk, reportedD20, reportedDamageRolls);
  }

  /** NPC attack: engine draws and records every die. */
  npcAttack(attackerId: string, targetId: string, atk: { toHit: number; damage: string; kind?: AttackKind },
            advantage: Advantage = "none"): void {
    const decl = this.declareAttack(attackerId, targetId, atk, advantage);
    const eff = (decl.payload as any).advantage as Advantage;
    const d20 = rollD20(this.rng, eff);
    const dmg = rollDice(atk.damage, this.rng);
    this.emit("engine_rolled", "gm",
      { attacker: attackerId, d20: d20.rolls, kept: d20.kept, damage: dmg }, attackerId, decl.id);
    this.resolveAttack(decl.id, attackerId, targetId, atk, d20.kept,
      dmg.rolls, dmg.modifier);
  }

  /** Shared declaration: folds condition effects into the effective advantage
   *  recorded on the event, so replay never re-derives condition rules. */
  private declareAttack(attackerId: string, targetId: string,
                        atk: { toHit: number; damage: string; kind?: AttackKind },
                        advantage: Advantage): GameEvent {
    const s = this.state();
    const attacker = s.combatants[attackerId], target = s.combatants[targetId];
    if (!attacker || !target) throw new Error("unknown combatant");
    // The dead are a hard stop; the merely unconscious are the Director's
    // problem — table flow (and the rewind gate) may legitimately replay them.
    if (attacker.conditions.includes("dead")) throw new Error(`${attackerId} cannot act`);
    const kind: AttackKind = atk.kind ?? "melee";
    const eff = combineAdvantage([advantage, ...attackFactors(attacker, target, kind)]);
    return this.emit("attack_declared", "public",
      { attacker: attackerId, target: targetId, attack: atk, advantage: eff }, attackerId);
  }

  private resolveAttack(causeId: number, attackerId: string, targetId: string,
                        atk: { toHit: number; damage: string; kind?: AttackKind }, d20: number,
                        damageRolls: number[], damageMod?: number): void {
    const s = this.state();
    const target = s.combatants[targetId];
    const kind: AttackKind = atk.kind ?? "melee";
    const hit = d20 === 20 || (d20 !== 1 && d20 + atk.toHit >= target.ac);
    const crit = d20 === 20 || (hit && autoCrit(target, kind));
    // outcome is public; target AC is not echoed back
    this.emit("attack_resolved", "public",
      { attacker: attackerId, target: targetId, d20, hit, crit }, attackerId, causeId);
    if (!hit) return;

    const m = damageMod ?? parseMod(atk.damage);
    let amount = damageRolls.reduce((a, b) => a + b, 0) + m;
    if (crit) amount += damageRolls.reduce((a, b) => a + b, 0); // simple crit: double dice
    this.applyDamage(targetId, amount, causeId, { crit });
  }

  applyDamage(targetId: string, amount: number, causes?: number, opts: { crit?: boolean } = {}): void {
    const before = this.state().combatants[targetId];
    const isNpc = before.side === "npc";
    if (before.conditions.includes("dead")) return;

    // Damage while dying (PC at 0 hp): death-save failures, not hp loss.
    if (!isNpc && before.hp === 0) {
      this.emit("damage_applied", [targetId], { target: targetId, amount }, null, causes);
      if (before.conditions.includes("stable"))
        this.emit("condition_changed", "public", { target: targetId, removed: "stable" }, null, causes);
      if (amount >= before.maxHp) { // massive damage at 0 hp: instant death
        this.emit("condition_changed", "public",
          { target: targetId, added: "dead", removed: "unconscious" }, null, causes);
        this.checkCombatEnd();
        return;
      }
      this.emit("death_save_recorded", "public",
        { target: targetId, result: "failure", count: opts.crit ? 2 : 1, source: "damage" }, null, causes);
      if (this.state().combatants[targetId].deathSaves.failures >= 3) {
        this.emit("condition_changed", "public",
          { target: targetId, added: "dead", removed: "unconscious" }, null, causes);
        this.checkCombatEnd();
      }
      return;
    }

    const tierBefore = healthDescriptor(before.hp, before.maxHp);
    // exact numbers: gm-visible for NPCs, private-to-owner for PCs
    const dmg = this.emit("damage_applied", isNpc ? "gm" : [targetId], { target: targetId, amount }, null, causes);
    const after = this.state().combatants[targetId];
    const tierAfter = healthDescriptor(after.hp, after.maxHp);
    if (tierAfter !== tierBefore)
      this.emit("health_tier_changed", "public", { target: targetId, tier: tierAfter }, null, causes);
    if (after.hp === 0) {
      if (before.concentratingOn) this.endConcentration(targetId, "incapacitated", dmg.id);
      const massive = amount - before.hp >= before.maxHp; // excess ≥ max hp: instant death
      this.emit("condition_changed", "public",
        { target: targetId, added: isNpc || massive ? "dead" : "unconscious" }, null, causes);
      this.checkCombatEnd();
      return;
    }
    // concentration check on damage: DC = max(10, half the damage). The DC
    // is mechanical and public; hybrid dice as ever — PCs report, NPCs roll.
    if (before.concentratingOn) {
      const dc = Math.max(10, Math.floor(amount / 2));
      if (isNpc)
        this.engineCheck({ actor: targetId, kind: "save", ability: "con", dc,
          purpose: { kind: "concentration" } });
      else
        this.callCheck({ actor: targetId, kind: "save", ability: "con", dc,
          dcVisibility: "public", purpose: { kind: "concentration" } });
    }
  }

  applyHealing(targetId: string, amount: number, causes?: number): void {
    const before = this.state().combatants[targetId];
    if (before.conditions.includes("dead")) throw new Error(`${targetId} is dead`);
    const isNpc = before.side === "npc";
    const tierBefore = healthDescriptor(before.hp, before.maxHp);
    this.emit("healing_applied", isNpc ? "gm" : [targetId], { target: targetId, amount }, null, causes);
    if (before.hp === 0 && amount > 0) {
      if (before.conditions.includes("unconscious"))
        this.emit("condition_changed", "public", { target: targetId, removed: "unconscious" }, null, causes);
      if (before.conditions.includes("stable"))
        this.emit("condition_changed", "public", { target: targetId, removed: "stable" }, null, causes);
    }
    const after = this.state().combatants[targetId];
    const tierAfter = healthDescriptor(after.hp, after.maxHp);
    if (tierAfter !== tierBefore)
      this.emit("health_tier_changed", "public", { target: targetId, tier: tierAfter }, null, causes);
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
    if (s.combatOver || !s.order.length) return;
    const pcs = activeOnSide(s, "pc").length, npcs = activeOnSide(s, "npc").length;
    if (pcs === 0 || npcs === 0)
      this.emit("combat_ended", "public", { winner: pcs > 0 ? "pc" : "npc" });
  }

  // ------------------------------------------------------ checks & saves
  /** Call a check or save on a PC. The DC is committed now (gm-visible
   *  companion event) — before any die is rolled — so the leak audit can
   *  prove it was never adjusted after the fact. Returns the check id the
   *  roll pad answers with. */
  callCheck(call: CheckCall): number {
    const sb = this.statFor(call.actor);
    const c = this.state().combatants[call.actor];
    if (!c) throw new Error(`not in scene: ${call.actor}`);
    const skill = call.skill ?? null;
    const modifier = call.kind === "save"
      ? saveModifier(sb, call.ability)
      : checkModifier(sb, call.ability, skill);
    const factors = call.kind === "save" ? saveFactors(c, call.ability) : checkFactors(c);
    const eff = combineAdvantage([call.advantage ?? "none", ...factors]);
    const dcVis = call.dcVisibility ?? "gm";

    const called = this.emit("check_called", "public",
      { actor: call.actor, kind: call.kind, ability: call.ability, skill,
        advantage: eff, modifier,
        ...(call.purpose ? { purpose: call.purpose } : {}),
        ...(dcVis === "public" ? { dc: call.dc, dcVisibility: "public" } : {}) },
      call.actor);
    if (dcVis === "gm")
      this.emit("check_called", "gm",
        { checkId: called.id, dc: call.dc, dcVisibility: "gm" }, call.actor, called.id);

    if (call.kind === "save" && autoFailsSave(c, call.ability))
      this.resolveCheck(called.id, null, { autoFail: true });
    return called.id;
  }

  /** Player reports their physical dice (two entries under adv/dis). */
  reportCheckRoll(checkId: number, rolls: number[]): void {
    const pending = this.state().pendingChecks[checkId];
    if (!pending) throw new Error(`no pending check ${checkId}`);
    if (pending.rolls) throw new Error(`check ${checkId} already rolled`);
    if (!rolls.length) throw new Error("no rolls reported");
    const kept = pending.advantage === "adv" ? Math.max(...rolls)
               : pending.advantage === "dis" ? Math.min(...rolls)
               : rolls[0];
    this.emit("roll_reported", "public", { checkId, rolls, kept }, pending.actor, checkId);
    this.resolveCheck(checkId, kept);
  }

  /** NPC / secret check: engine draws the die; nothing about it is public.
   *  The Director decides what (if anything) players learn, via reveals. */
  engineCheck(call: CheckCall): { checkId: number; outcome: "success" | "failure" } {
    const sb = this.statFor(call.actor);
    const c = this.state().combatants[call.actor];
    if (!c) throw new Error(`not in scene: ${call.actor}`);
    const skill = call.skill ?? null;
    const modifier = call.kind === "save"
      ? saveModifier(sb, call.ability)
      : checkModifier(sb, call.ability, skill);
    const factors = call.kind === "save" ? saveFactors(c, call.ability) : checkFactors(c);
    const eff = combineAdvantage([call.advantage ?? "none", ...factors]);

    const called = this.emit("check_called", "gm",
      { actor: call.actor, kind: call.kind, ability: call.ability, skill,
        advantage: eff, modifier, dc: call.dc, dcVisibility: "gm",
        ...(call.purpose ? { purpose: call.purpose } : {}) }, call.actor);
    if (call.kind === "save" && autoFailsSave(c, call.ability)) {
      this.resolveCheck(called.id, null, { autoFail: true, secret: true });
      return { checkId: called.id, outcome: "failure" };
    }
    const r = rollD20(this.rng, eff);
    this.emit("engine_rolled", "gm", { checkId: called.id, rolls: r.rolls, kept: r.kept },
      call.actor, called.id);
    const outcome = this.resolveCheck(called.id, r.kept, { secret: true });
    return { checkId: called.id, outcome };
  }

  /** Passive check (2024: 10 + modifier, ±5 for adv/dis). Entirely gm-visible:
   *  a player must never learn their passive senses were consulted. */
  passiveCheck(actorId: string, skill: string, dc: number): { score: number; outcome: "success" | "failure" } {
    const ability = SKILL_ABILITY[skill];
    if (!ability) throw new Error(`unknown skill: ${skill}`);
    const sb = this.statFor(actorId);
    const c = this.state().combatants[actorId];
    if (!c) throw new Error(`not in scene: ${actorId}`);
    const eff = combineAdvantage(checkFactors(c));
    const modifier = checkModifier(sb, ability, skill);
    const score = 10 + modifier + (eff === "adv" ? 5 : eff === "dis" ? -5 : 0);
    const outcome = score >= dc ? "success" : "failure";
    this.emit("check_resolved", "gm",
      { checkId: null, actor: actorId, kind: "check", method: "passive", ability, skill,
        score, modifier, dc, dc_visibility: "gm", outcome }, actorId);
    return { score, outcome };
  }

  private resolveCheck(checkId: number, kept: number | null,
                       opts: { autoFail?: boolean; secret?: boolean } = {}): "success" | "failure" {
    const p: PendingCheck | undefined = this.state().pendingChecks[checkId];
    if (!p) throw new Error(`no pending check ${checkId}`);
    if (p.dc == null) throw new Error(`check ${checkId} has no committed DC`);
    const total = kept == null ? null : kept + p.modifier;
    const outcome: "success" | "failure" =
      opts.autoFail ? "failure"
      : kept === 20 ? "success"   // 2024 d20 Tests: nat 20 always succeeds,
      : kept === 1 ? "failure"    // nat 1 always fails
      : total! >= p.dc ? "success" : "failure";

    const full = { checkId, actor: p.actor, kind: p.kind, ability: p.ability, skill: p.skill,
      roll: kept, modifier: p.modifier, total, dc: p.dc, dc_visibility: p.dcVisibility,
      outcome, advantage: p.advantage, ...(opts.autoFail ? { auto: "unconscious_auto_fail" } : {}) };

    if (opts.secret) {
      this.emit("check_resolved", "gm", full, p.actor, checkId);
    } else if (p.dcVisibility === "gm") {
      this.emit("check_resolved", "gm", full, p.actor, checkId);
      const { dc: _dc, ...pub } = full; // public twin: outcome without the DC
      this.emit("check_resolved", "public", pub, p.actor, checkId);
    } else {
      this.emit("check_resolved", "public", full, p.actor, checkId);
    }
    // mechanical follow-ups the check was called FOR
    if ((p.purpose as any)?.kind === "concentration" && outcome === "failure")
      this.endConcentration(p.actor, "failed_save", checkId);
    return outcome;
  }

  // --------------------------------------------------------- concentration
  /** Begin concentrating (replaces any previous concentration — 2024 rules:
   *  one spell at a time). PC concentration is table-visible; NPC is gm. */
  startConcentration(id: string, spell: string, causes?: number): void {
    const c = this.state().combatants[id];
    if (!c) throw new Error(`unknown combatant: ${id}`);
    if (c.concentratingOn)
      this.emit("concentration_ended", c.side === "npc" ? "gm" : "public",
        { target: id, spell: c.concentratingOn, reason: "replaced" }, id, causes);
    this.emit("concentration_started", c.side === "npc" ? "gm" : "public",
      { target: id, spell }, id, causes);
  }

  endConcentration(id: string, reason: string, causes?: number): void {
    const c = this.state().combatants[id];
    if (!c?.concentratingOn) return;
    this.emit("concentration_ended", c.side === "npc" ? "gm" : "public",
      { target: id, spell: c.concentratingOn, reason }, id, causes);
  }

  // ---------------------------------------------------------- death saves
  /** Death save, reported by the player (public table drama, DC 10 fixed).
   *  Nat 20: regain 1 hp. Nat 1: two failures. Three failures: dead.
   *  Three successes: stable. */
  deathSave(pcId: string, reportedD20: number): void {
    const c = this.state().combatants[pcId];
    if (!c || c.side !== "pc") throw new Error(`not a PC: ${pcId}`);
    if (c.hp > 0 || !c.conditions.includes("unconscious")) throw new Error(`${pcId} is not dying`);
    if (c.conditions.includes("dead") || c.conditions.includes("stable"))
      throw new Error(`${pcId} is not rolling death saves`);

    const rep = this.emit("roll_reported", "public",
      { deathSave: true, actor: pcId, rolls: [reportedD20], kept: reportedD20 }, pcId);
    if (reportedD20 === 20) { // back on your feet with 1 hp
      this.applyHealing(pcId, 1, rep.id);
      return;
    }
    const result = reportedD20 >= 10 ? "success" : "failure";
    const count = reportedD20 === 1 ? 2 : 1;
    this.emit("death_save_recorded", "public",
      { target: pcId, result, count, roll: reportedD20 }, pcId, rep.id);

    const after = this.state().combatants[pcId].deathSaves;
    if (after.failures >= 3) {
      this.emit("condition_changed", "public",
        { target: pcId, added: "dead", removed: "unconscious" }, null, rep.id);
      this.checkCombatEnd();
    } else if (after.successes >= 3) {
      this.emit("condition_changed", "public", { target: pcId, added: "stable" }, null, rep.id);
    }
  }

  // ------------------------------------------------------- slots & rests
  /** Spend a spell slot. Throws if none remain — the engine, not the model,
   *  is the bookkeeper. Slot accounting is the caster's private sheet data. */
  castSpell(casterId: string, level: number, opts: { concentration?: string } = {}): void {
    const c = this.state().combatants[casterId];
    if (!c) throw new Error(`unknown combatant: ${casterId}`);
    const pool = c.slots[level];
    if (!pool || pool.used >= pool.max) throw new Error(`${casterId} has no level-${level} slot`);
    const spent = this.emit("slot_spent", c.side === "npc" ? "gm" : [casterId],
      { caster: casterId, level, remaining: pool.max - pool.used - 1 }, casterId);
    if (opts.concentration) this.startConcentration(casterId, opts.concentration, spent.id);
  }

  /** Short-rest hit die: the player rolls it physically and reports it. */
  spendHitDie(pcId: string, reportedRoll: number): void {
    const c = this.state().combatants[pcId];
    if (!c) throw new Error(`unknown combatant: ${pcId}`);
    if (!c.hitDice || c.hitDice.used >= c.hitDice.max)
      throw new Error(`${pcId} has no hit dice left`);
    const healed = Math.max(0, reportedRoll + mod(this.statFor(pcId).abilities.con));
    const ev = this.emit("hit_die_spent", [pcId],
      { target: pcId, die: c.hitDice.die, roll: reportedRoll, healed }, pcId);
    this.applyHealing(pcId, healed, ev.id);
  }

  /** Long rest restores hp, slots, death saves, and hit dice (half, min 1)
   *  for living participants — the fold applies it, the engine just records. */
  rest(type: "short" | "long", participants: string[]): void {
    this.emit("downtime_applied", "public", { rest: type, participants });
  }

  // ----------------------------------------------------------- conditions
  setCondition(targetId: string, change: { add?: string; remove?: string },
               visibility: Visibility = "public", causes?: number): void {
    if (!this.state().combatants[targetId]) throw new Error(`unknown combatant: ${targetId}`);
    this.emit("condition_changed", visibility,
      { target: targetId, ...(change.add ? { added: change.add } : {}),
        ...(change.remove ? { removed: change.remove } : {}) }, null, causes);
  }

  // ------------------------------------------------------------- reveals
  revealFact(factId: string, to: "party" | string[], text: string): void {
    this.emit("fact_revealed", to === "party" ? "public" : to, { factId, to, text });
  }

  // --------------------------------------------------- character creation
  /** Create a player character from a validated build. The engine is the
   *  legality authority: illegal builds throw before any event lands. The
   *  event embeds the derived snapshot, so the fold applies data and replay
   *  never recomputes rules. Sheet is private to the owner (decision 21). */
  createCharacter(build: CharacterBuild): ReturnType<typeof derive> {
    if (this.state().combatants[build.id]) throw new Error(`id taken: ${build.id}`);
    const sheet = derive(build); // throws on illegal builds
    this.stats.set(build.id, sheet);
    this.emit("character_created", [build.id], {
      id: build.id, name: sheet.name, side: "pc",
      statRef: build.id, ac: sheet.ac, maxHp: sheet.maxHp,
      ...(sheet.slots ? { slots: sheet.slots } : {}),
      hitDice: { die: sheet.hitDice!.die, count: sheet.hitDice!.count },
      level: sheet.level, species: sheet.species, class: sheet.class,
      background: sheet.background, speed: sheet.speed,
      abilities: sheet.finalAbilities, skills: sheet.skills,
      saves: sheet.saves, attacks: sheet.attacks,
      armorName: sheet.armorName, passivePerception: sheet.passivePerception,
      traits: sheet.traits, build,
    }, build.id);
    return sheet;
  }

  /** The player's spoken origin story, on their private record. */
  recordBackstory(charId: string, text: string, summary?: string): GameEvent {
    if (!this.state().combatants[charId]) throw new Error(`unknown character: ${charId}`);
    return this.emit("backstory_recorded", [charId],
      { target: charId, text, ...(summary ? { summary } : {}) }, charId);
  }

  /** The portrait-anchor moment — public: the table sees faces. */
  attachPortrait(charId: string, assetRef: string, prompt: string): GameEvent {
    if (!this.state().combatants[charId]) throw new Error(`unknown character: ${charId}`);
    return this.emit("portrait_attached", "public",
      { target: charId, asset: assetRef, prompt }, charId);
  }

  // ------------------------------------------------------------ inventory
  grantItem(charId: string,
            item: { id: string; name: string; tags?: string[];
                    effect?: { kind: "heal"; dice: string } },
            causes?: number): void {
    if (!this.state().combatants[charId]) throw new Error(`unknown character: ${charId}`);
    this.emit("item_granted", [charId], { target: charId, item }, null, causes);
  }

  /** Use (consume) an item the character actually carries. Effects apply
   *  through normal engine paths; hybrid dice as ever — a PC drinking a
   *  potion reports the dice, an NPC's are drawn and recorded. */
  useItem(charId: string, itemId: string,
          opts: { reportedRolls?: number[] } = {}, causes?: number): void {
    const c = this.state().combatants[charId];
    if (!c) throw new Error(`unknown character: ${charId}`);
    const item = c.inventory.find(i => i.id === itemId) as
      (typeof c.inventory[number] & { effect?: { kind: "heal"; dice: string } }) | undefined;
    if (!item) throw new Error(`${charId} does not carry ${itemId}`);
    // validate BEFORE consuming — a refused use must leave the item carried
    if (item.effect?.kind === "heal" && c.side === "pc" && !opts.reportedRolls?.length)
      throw new Error(`${item.name} heals ${item.effect.dice} — report the dice`);
    const used = this.emit("item_used", [charId], { target: charId, itemId }, charId, causes);
    if (item.effect?.kind === "heal") {
      let amount: number;
      if (c.side === "pc") {
        amount = opts.reportedRolls!.reduce((a, b) => a + b, 0) + parseMod(item.effect.dice);
      } else {
        const dmg = rollDice(item.effect.dice, this.rng);
        this.emit("engine_rolled", "gm", { itemId, rolls: dmg.rolls, total: dmg.total }, charId, used.id);
        amount = dmg.total;
      }
      this.applyHealing(charId, amount, used.id);
    }
  }

  // -------------------------------------------------------------- leveling
  /** Validated level-up; hp by average or the player's reported roll. */
  levelUp(charId: string, toLevel: number,
          hp: { method: "average" } | { method: "roll"; reported: number }): void {
    const c = this.state().combatants[charId];
    if (!c) throw new Error(`unknown character: ${charId}`);
    const created = this.store.timeline().find(e =>
      e.type === "character_created" && (e.payload as any).id === charId);
    if (!created) throw new Error(`${charId} was not made by createCharacter`);
    const build = (created.payload as any).build as CharacterBuild;
    const delta = deriveLevelUp({ ...build, level: c.level }, toLevel, hp); // throws if illegal
    this.emit("level_up", [charId], { target: charId, ...delta }, charId);
  }

  // ----------------------------------------------------------- the scene
  /** Where play happens. Public by definition — the party is standing in
   *  it. Drives the screen's establishing moment, location banners, maps,
   *  and recaps as folds; presentation never gets a side-channel. */
  setScene(loc: { id: string; name: string; mood?: string; palette?: string }): GameEvent {
    return this.emit("scene_set", "public",
      { location_id: loc.id, name: loc.name,
        ...(loc.mood ? { mood: loc.mood } : {}),
        ...(loc.palette ? { palette: loc.palette } : {}) }, "tally");
  }

  /** An entity arriving somewhere. Visibility is the Director's call —
   *  an unseen ambusher moves gm-side. */
  moveEntity(entityId: string, toLocationId: string,
             visibility: Visibility = "public", causes?: number): GameEvent {
    return this.emit("entity_moved", visibility,
      { entity_id: entityId, to: toLocationId }, null, causes);
  }

  // ------------------------------------------------- session & narration
  /** A player's spoken/typed declaration, on the record (public). */
  declare(actorId: string, text: string): GameEvent {
    return this.emit("declaration", "public", { text }, actorId);
  }

  /** Pip's delivered prose enters the log — the revealed transcript IS the
   *  event stream, so recaps and the Narrator context share one source. */
  recordNarration(text: string, beatId?: string): GameEvent {
    return this.emit("narration_delivered", "public",
      { text, ...(beatId ? { beatId } : {}) }, "pip");
  }

  /** A Narrator invention the Director accepted into the world (decision
   *  13 refinement): captured, never silently drifted. */
  ratifyCanon(assertion: string, source = "narrator", causes?: number): GameEvent {
    return this.emit("canon_ratified", "public", { assertion, source }, "tally", causes);
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
