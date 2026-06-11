/** WebSocket client + reactive session state. The server already filtered
 *  every event for this client's role (invariant 2 lives server-side); this
 *  module just renders what it was allowed to hear. */

import { writable, derived } from "svelte/store";

export type Role = "box" | "screen" | "host";

export interface Narration { text: string; durationMs: number; hasAudio: boolean }
export interface RollRequest {
  checkId: number; kind: string; ability: string;
  skill: string | null; modifier: number; advantage: "none" | "adv" | "dis";
}

export const connection = writable<"idle" | "connecting" | "open" | "closed">("idle");
export const joined = writable<{ role: Role; characterId: string | null } | null>(null);
export const mediaKind = writable<string>("mock");
export const events = writable<any[]>([]);
export const narrations = writable<Narration[]>([]);
export const rollRequests = writable<RollRequest[]>([]);
export const floor = writable<{ mode: string; queue: string[] }>({ mode: "exploration", queue: [] });
export const roster = writable<{ role: Role; characterId: string | null }[]>([]);
export const toasts = writable<{ id: number; text: string }[]>([]);
export const lastError = writable<string | null>(null);

/** Raw-message hooks (the screen's mixer subscribes here). */
export const listeners = new Set<(msg: any) => void>();

let ws: WebSocket | null = null;
let toastSeq = 0;

export function connect(opts: { role: Role; characterId?: string }): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  connection.set("connecting");
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    connection.set("open");
    send({ type: "join", role: opts.role, characterId: opts.characterId });
  };
  ws.onclose = () => { connection.set("closed"); joined.set(null); };
  ws.onmessage = e => {
    let msg: any;
    try { msg = JSON.parse(e.data); } catch { return; }
    handle(msg);
    for (const fn of listeners) fn(msg);
  };
}

export function send(msg: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(msg: any): void {
  switch (msg.type) {
    case "joined":
      joined.set({ role: msg.role, characterId: msg.characterId ?? null });
      mediaKind.set(msg.media ?? "mock");
      return;
    case "events":
      events.update(a => [...a, ...msg.events]);
      for (const e of msg.events)
        if (e.type === "fact_revealed" && Array.isArray(e.visibility))
          toast(`Only you notice: ${e.payload.text}`); // the private-reveal moment
      return;
    case "narration":
      narrations.update(a => [...a, msg]);
      return;
    case "roll_request":
      rollRequests.update(a => [...a, msg]);
      toast(`Roll called: ${label(msg)}`);
      return;
    case "truncate": // a rewind cut the timeline; drop what no longer happened
      events.update(a => a.filter(e => e.id <= msg.after));
      narrations.update(() => []);
      rollRequests.update(a => a.filter(r => r.checkId <= msg.after));
      return;
    case "xcard_rewound":
      toast("The thread of fate frays and reweaves…");
      return;
    case "rewound":
      toast(`Rewound to event ${msg.to}.`);
      return;
    case "floor": floor.set(msg); return;
    case "roster": roster.set(msg.clients); return;
    case "error": lastError.set(msg.error); return;
  }
}

export function reportRoll(checkId: number, rolls: number[]): void {
  send({ type: "roll", checkId, rolls });
  rollRequests.update(a => a.filter(r => r.checkId !== checkId));
}

export function toast(text: string): void {
  const id = ++toastSeq;
  toasts.update(a => [...a, { id, text }]);
  setTimeout(() => toasts.update(a => a.filter(t => t.id !== id)), 6000);
}

export function label(r: RollRequest): string {
  const skill = r.skill ? ` (${r.skill.replace(/_/g, " ")})` : "";
  const adv = r.advantage === "adv" ? " — advantage" : r.advantage === "dis" ? " — disadvantage" : "";
  const sign = r.modifier >= 0 ? "+" : "";
  return `${r.ability.toUpperCase()}${skill} ${sign}${r.modifier}${adv}`;
}

/** A Box's own sheet, folded from the events it was allowed to see —
 *  the phone never invents a number the log doesn't carry. */
export const sheet = derived([events, joined], ([$events, $joined]) => {
  const id = $joined?.characterId;
  if (!id) return null;
  let s: any = null;
  for (const e of $events) {
    const p = e.payload ?? {};
    if ((e.type === "combatant_joined" || e.type === "character_created") && p.id === id) {
      s = { ...p, hp: p.maxHp, conditions: [] as string[],
        inventory: [] as any[], portrait: null,
        deathSaves: { successes: 0, failures: 0 },
        slotsUsed: {} as Record<string, number> };
    }
    if (!s) continue;
    if (p.target !== id && p.caster !== id && p.id !== id) continue;
    switch (e.type) {
      case "damage_applied": s.hp = Math.max(0, s.hp - p.amount);
        if (s.hp === 0) s.deathSaves = { successes: 0, failures: 0 }; break;
      case "healing_applied":
        if (s.hp === 0 && p.amount > 0) s.deathSaves = { successes: 0, failures: 0 };
        s.hp = Math.min(s.maxHp, s.hp + p.amount); break;
      case "condition_changed":
        if (p.added && !s.conditions.includes(p.added)) s.conditions = [...s.conditions, p.added];
        if (p.removed) s.conditions = s.conditions.filter((c: string) => c !== p.removed);
        if (p.added === "stable") s.deathSaves = { successes: 0, failures: 0 };
        break;
      case "death_save_recorded": {
        const k = p.result === "success" ? "successes" : "failures";
        s.deathSaves = { ...s.deathSaves, [k]: s.deathSaves[k] + (p.count ?? 1) };
        break;
      }
      case "slot_spent":
        s.slotsUsed = { ...s.slotsUsed, [p.level]: (s.slotsUsed[p.level] ?? 0) + 1 }; break;
      case "item_granted": s.inventory = [...s.inventory, p.item]; break;
      case "item_used": s.inventory = s.inventory.filter((i: any) => i.id !== p.itemId); break;
      case "portrait_attached": s.portrait = p.asset; break;
      case "level_up":
        s.level = p.level; s.maxHp += p.maxHpDelta; s.hp += p.maxHpDelta;
        if (p.slots) s.slots = p.slots;
        break;
      case "downtime_applied": break; // long-rest fold below is server-truth; skip client guess
    }
  }
  return s;
});

/** What this character KNOWS — the Journal tab: private reveals, party
 *  facts, ratified canon, their own origin story. */
export const journal = derived([events, joined], ([$events, $joined]) => {
  const id = $joined?.characterId;
  const out: { id: number; kind: string; text: string; private?: boolean }[] = [];
  for (const e of $events) {
    const p = e.payload ?? {};
    if (e.type === "fact_revealed")
      out.push({ id: e.id, kind: "learned", text: p.text, private: Array.isArray(e.visibility) });
    if (e.type === "canon_ratified")
      out.push({ id: e.id, kind: "established", text: p.assertion });
    if (e.type === "backstory_recorded" && p.target === id)
      out.push({ id: e.id, kind: "origin", text: p.text, private: true });
  }
  return out;
});

/** Shared transcript (declarations + narration) from the event slice. */
export const transcript = derived(events, $events =>
  $events
    .filter(e => e.type === "declaration" || e.type === "narration_delivered")
    .map(e => ({
      id: e.id,
      who: e.type === "declaration" ? (e.actor ?? "someone") : "Pip",
      text: (e.payload as any).text as string,
    })));
