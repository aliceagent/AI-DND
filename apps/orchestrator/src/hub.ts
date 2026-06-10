/** The session hub: role-gated client feeds over one event stream.
 *  Invariant 2 enforced at the wire: a Box receives exactly
 *  store.visibleTo(characterId); the screen receives public; only the host
 *  sees the gm timeline. Transport-agnostic (tests drive it with fake
 *  connections; server.ts binds it to WebSockets).
 *
 *  Floor control (build plan §1.9): exploration = press-order queue;
 *  combat = initiative owns the floor (active combatant jumps the queue).
 *  X-card = rewind-as-rebranch to the last turn checkpoint, anonymous. */

import { Engine } from "../../../engine/src/engine.js";
import type { GameEvent } from "../../../engine/src/store.js";
import type { DungeonMaster } from "./dm.js";
import type { MediaService } from "./media.js";

export type Role = "box" | "screen" | "host";

export interface ClientConn { send(msg: unknown): void }

interface Client {
  id: string;
  conn: ClientConn;
  role: Role;
  characterId?: string;
  cursor: number;          // last event id delivered
}

export class SessionHub {
  private clients = new Map<string, Client>();
  private floorQueue: string[] = [];      // characterIds, press order
  private checkpoints: number[] = [];     // event ids at turn starts (x-card targets)
  private xcardCount = 0;
  private opened = false;
  private turnChain: Promise<void> = Promise.resolve(); // one turn at a time

  constructor(readonly engine: Engine, private dm: DungeonMaster, private media: MediaService) {}

  // ---------------------------------------------------------------- joins
  join(id: string, conn: ClientConn, opts: { role: Role; characterId?: string }): void {
    if (opts.role === "box" && !opts.characterId) throw new Error("box join needs characterId");
    const client: Client = { id, conn, role: opts.role, characterId: opts.characterId, cursor: 0 };
    this.clients.set(id, client);
    this.sendTo(client, { type: "joined", role: opts.role, characterId: opts.characterId,
      media: this.media.kind });
    this.flushTo(client); // full visible history on join — late phones catch up
    this.broadcastRoster();
  }

  leave(id: string): void {
    const c = this.clients.get(id);
    this.clients.delete(id);
    if (c?.characterId) this.floorQueue = this.floorQueue.filter(x => x !== c.characterId);
    this.broadcastRoster();
  }

  /** Open the scene (host action or first screen connect). */
  async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    await this.enqueueTurn(async () => {
      this.checkpoints.push(this.tip());
      const narration = await this.dm.openScene(this.engine);
      await this.deliver(narration);
    });
  }

  // ------------------------------------------------------------- messages
  async handle(clientId: string, msg: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`unknown client ${clientId}`);
    switch (msg?.type) {
      case "ptt_start": {
        this.requireBox(client);
        if (!this.floorQueue.includes(client.characterId!)) this.floorQueue.push(client.characterId!);
        this.broadcastFloor();
        return;
      }
      case "ptt_end": {
        this.requireBox(client);
        const { text } = await this.media.stt({ text: msg.text, audio: msg.audio });
        this.floorQueue = this.floorQueue.filter(x => x !== client.characterId);
        this.broadcastFloor();
        await this.declarationTurn(client.characterId!, text);
        return;
      }
      case "declare": { // mock-mode text path (and accessibility fallback)
        this.requireBox(client);
        await this.declarationTurn(client.characterId!, String(msg.text ?? ""));
        return;
      }
      case "roll": {
        this.requireBox(client);
        const checkId = Number(msg.checkId);
        const pending = this.engine.state().pendingChecks[checkId];
        if (!pending || pending.actor !== client.characterId)
          throw new Error(`no pending check ${checkId} for ${client.characterId}`);
        await this.enqueueTurn(async () => {
          this.engine.reportCheckRoll(checkId, (msg.rolls as number[]).map(Number));
          const narration = await this.dm.afterRoll(this.engine, checkId);
          await this.deliver(narration);
        });
        return;
      }
      case "xcard": {
        // anyone may x-card; it is anonymous by design
        await this.enqueueTurn(async () => this.xcard());
        return;
      }
      case "rewind": {
        this.requireHost(client);
        await this.enqueueTurn(async () => this.rewindTo(Number(msg.eventId)));
        return;
      }
      default:
        this.sendTo(client, { type: "error", error: `unknown message type: ${msg?.type}` });
    }
  }

  // ----------------------------------------------------------- turn logic
  private async declarationTurn(characterId: string, text: string): Promise<void> {
    await this.enqueueTurn(async () => {
      this.checkpoints.push(this.tip());
      this.engine.declare(characterId, text);
      this.flushAll();
      const narration = await this.dm.takeTurn(this.engine, { actor: characterId, text });
      await this.deliver(narration);
    });
  }

  /** Narration → log → tts → role-gated fan-out (+ roll prompts). */
  private async deliver(narration: string): Promise<void> {
    this.engine.recordNarration(narration);
    const speech = await this.media.tts(narration);
    this.flushAll();
    this.broadcast({ type: "narration", text: narration,
      durationMs: speech.durationMs, hasAudio: speech.audio !== null });
    for (const p of Object.values(this.engine.state().pendingChecks)) {
      if (p.rolls !== null) continue;
      const box = [...this.clients.values()].find(c => c.role === "box" && c.characterId === p.actor);
      if (box) this.sendTo(box, { type: "roll_request", checkId: p.id, kind: p.kind,
        ability: p.ability, skill: p.skill, modifier: p.modifier, advantage: p.advantage });
    }
  }

  private xcard(): void {
    // rewind to the checkpoint before the current turn's content
    const target = this.checkpoints.pop() ?? this.tip();
    this.engine.rewindTo(target, `xcard-${++this.xcardCount}`);
    this.resetCursors(target);
    this.broadcast({ type: "truncate", after: target }); // clients drop stale events
    this.broadcast({ type: "xcard_rewound" }); // no attribution, ever
    this.flushAll();
  }

  private rewindTo(eventId: number): void {
    this.engine.rewindTo(eventId, `host-rewind-${++this.xcardCount}`);
    this.resetCursors(eventId);
    this.broadcast({ type: "truncate", after: eventId });
    this.broadcast({ type: "rewound", to: eventId });
    this.flushAll();
  }

  // ------------------------------------------------------------ fan-out
  /** Events a client is entitled to: the wire-level visibility filter. */
  private slice(client: Client): GameEvent[] {
    if (client.role === "host") return this.engine.store.timeline();
    if (client.role === "screen")
      return this.engine.store.timeline().filter(e => e.visibility === "public");
    return this.engine.store.visibleTo(client.characterId!);
  }

  private flushTo(client: Client): void {
    const fresh = this.slice(client).filter(e => e.id > client.cursor);
    if (!fresh.length) return;
    client.cursor = Math.max(client.cursor, ...fresh.map(e => e.id));
    this.sendTo(client, { type: "events", events: fresh });
  }

  flushAll(): void { for (const c of this.clients.values()) this.flushTo(c); }

  private resetCursors(to: number): void {
    for (const c of this.clients.values()) c.cursor = Math.min(c.cursor, to);
  }

  private broadcast(msg: unknown): void { for (const c of this.clients.values()) this.sendTo(c, msg); }

  private broadcastRoster(): void {
    this.broadcast({ type: "roster", clients: [...this.clients.values()]
      .map(c => ({ role: c.role, characterId: c.characterId ?? null })) });
  }

  private broadcastFloor(): void {
    // combat: initiative owns the floor — the active combatant heads the queue
    const s = this.engine.state();
    let queue = [...this.floorQueue];
    if (s.order.length && !s.combatOver) {
      const active = s.order[s.turnIndex];
      queue = [active, ...queue.filter(x => x !== active)];
    }
    this.broadcast({ type: "floor", mode: s.order.length && !s.combatOver ? "combat" : "exploration", queue });
  }

  // ------------------------------------------------------------- helpers
  private enqueueTurn(work: () => Promise<void>): Promise<void> {
    const next = this.turnChain.then(work);
    this.turnChain = next.catch(() => {}); // a failed turn never wedges the table
    return next;
  }

  private tip(): number {
    const tl = this.engine.store.timeline();
    return tl.length ? tl[tl.length - 1].id : 0;
  }

  private sendTo(client: Client, msg: unknown): void {
    try { client.conn.send(msg); } catch { /* dead socket; leave() handles it */ }
  }

  private requireBox(c: Client): void {
    if (c.role !== "box" || !c.characterId) throw new Error("box role required");
  }

  private requireHost(c: Client): void {
    if (c.role !== "host") throw new Error("host role required");
  }
}
