/** Watch a seeded skirmish: `npx tsx demo.ts [engineSeed] [tableSeed]`
 *  Prints the GM view and, for contrast, what one player's Box would see. */
import { Engine } from "./src/engine.js";
import { activeOnSide } from "./src/state.js";
import { KOBOLD, PCS, type StatBlock } from "./src/srd.js";
import { mulberry32, rollDice, rollD20 } from "./src/rng.js";

const engineSeed = parseInt(process.argv[2] ?? "1234", 10);
const tableSeed = parseInt(process.argv[3] ?? "5678", 10);

const STATS: Record<string, StatBlock> = { "srd.kobold": KOBOLD };
for (const pc of PCS) STATS[pc.ref] = pc;

const eng = new Engine(engineSeed);
const table = mulberry32(tableSeed);
for (const pc of PCS) eng.join(pc.ref, pc);
for (let i = 1; i <= 8; i++) eng.join(`kobold.${i}`, { ...KOBOLD, name: `Kobold ${i}` });
eng.rollInitiativeAll(STATS);

let active = eng.state().order[0];
while (!eng.state().combatOver) {
  const s = eng.state();
  const me = s.combatants[active];
  const foes = activeOnSide(s, me.side === "pc" ? "npc" : "pc");
  if (foes.length) {
    const t = foes[0], atk = STATS[me.statRef].attacks[0];
    if (me.side === "pc") {
      const d20 = rollD20(table, "none").kept;
      const dmg = rollDice(atk.damage, table);
      eng.pcAttack(me.id, t.id, atk, d20, dmg.rolls);
    } else eng.npcAttack(me.id, t.id, atk);
  }
  const next = eng.advanceTurn();
  if (!next) break;
  active = next;
}

console.log(`=== GM timeline (seed ${engineSeed}/${tableSeed}) ===`);
for (const e of eng.store.timeline()) {
  const p = e.payload as any;
  if (e.type === "attack_resolved")
    console.log(`  r? ${p.attacker} -> ${p.target}: d20=${p.d20} ${p.hit ? (p.crit ? "CRIT" : "hit") : "miss"}`);
  if (e.type === "damage_applied") console.log(`      ${p.target} takes ${p.amount}`);
  if (e.type === "health_tier_changed") console.log(`      ${p.target} is ${p.tier}`);
  if (e.type === "condition_changed") console.log(`      ${p.target}: ${p.added}`);
  if (e.type === "combat_ended") console.log(`=== winner: ${p.winner} ===`);
}

console.log(`\n=== what Vex's Box sees (no monster numbers anywhere) ===`);
for (const e of eng.store.visibleTo("pc.rogue")) {
  const p = e.payload as any;
  if (e.type === "health_tier_changed") console.log(`  ${p.target} looks ${p.tier}`);
  if (e.type === "damage_applied") console.log(`  Vex takes ${p.amount}`);
  if (e.type === "combat_ended") console.log(`  victory: ${p.winner}`);
}
