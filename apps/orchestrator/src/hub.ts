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
import { InterviewSession, type InterviewInput } from "./interview.js";
import { createDistiller, buildPortraitPrompt, fnv1a, type BlockDistiller } from "./charvis.js";
import type { CharacterBuild } from "../../../engine/src/character.js";
import type { DemoScene } from "./scenes.js";
import { EchoDM } from "./dm.js";
import { runBeat, type Campaign } from "./campaign.js";

export type Role = "box" | "screen" | "host" | "creator";

export interface ClientConn { send(msg: unknown): void }

interface Client {
  id: string;
  conn: ClientConn;
  role: Role;
  characterId?: string;
  cursor: number;          // last event id delivered
  interview?: InterviewSession;
}

export class SessionHub {
  private clients = new Map<string, Client>();
  private floorQueue: string[] = [];      // characterIds, press order
  private checkpoints: number[] = [];     // event ids at turn starts (x-card targets)
  private xcardCount = 0;
  private opened = false;
  private turnChain: Promise<void> = Promise.resolve(); // one turn at a time

  private rerolls = new Map<string, number>();   // characterId -> portrait rerolls used
  private builds = new Map<string, CharacterBuild>();
  private paceVotes: { characterId: string; dir: "up" | "down"; seq: number }[] = [];
  private paceSeq = 0;
  /** Table State vector (build plan §1.4): aggregate telemetry, never
   *  content. Sequence-ordered so "who's been quiet longest" is
   *  deterministic; the room-loudness channel waits for hardware. */
  private telemetry = new Map<string, { ptt: number; declarations: number; taps: number; lastSeq: number }>();
  private activitySeq = 0;
  private approvals: { kind: "character" | "portrait"; characterId: string; status: "pending" | "approved" | "rejected" }[] = [];
  private levelOffers = new Map<string, number>();   // characterId -> offered level

  constructor(readonly engine: Engine, private dm: DungeonMaster, private media: MediaService,
              private distiller: BlockDistiller = createDistiller(),
              /** Per-process secret handed only to host clients — gates the
               *  Bench HTTP endpoints. */
              readonly benchToken: string | null = null,
              /** Loaded presentation pack (host-driven campaign mode). */
              private campaign: Campaign | null = null) {}

  // ---------------------------------------------------------------- joins
  join(id: string, conn: ClientConn, opts: { role: Role; characterId?: string }): void {
    if (opts.role === "box" && !opts.characterId) throw new Error("box join needs characterId");
    if (opts.role === "box" && !this.engine.state().combatants[opts.characterId!])
      throw new Error(`unknown character: ${opts.characterId}`); // rebind is to the character
    const client: Client = { id, conn, role: opts.role, characterId: opts.characterId, cursor: 0 };
    this.clients.set(id, client);
    if (opts.role === "creator") {
      client.interview = new InterviewSession(cid => !!this.engine.state().combatants[cid]);
      this.sendTo(client, { type: "joined", role: "creator", media: this.media.kind });
      this.sendTo(client, { type: "interview_state", ...client.interview.state });
      this.broadcastRoster();
      return;
    }
    this.sendTo(client, { type: "joined", role: opts.role, characterId: opts.characterId,
      media: this.media.kind,
      ...(opts.role === "host" && this.benchToken ? { benchToken: this.benchToken } : {}) });
    this.flushTo(client); // full visible history on join — late phones catch up
    const map = this.mapPayload();
    if (map) this.sendTo(client, { type: "map", ...map });
    if (opts.role === "host") {
      this.broadcastApprovals();
      this.broadcastTableState();
      if (this.campaign) // the Beat Navigator: titles + gm panels, host eyes only
        this.sendTo(client, { type: "beats", campaign: this.campaign.title,
          beats: this.campaign.beats.map(b => ({ id: b.id, title: b.title,
            location: this.campaign!.locations[b.location]?.name,
            hasEncounter: !!b.encounter, gm: b.gm ?? null })) });
    }
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
        this.touch(client.characterId!, "ptt");
        if (!this.floorQueue.includes(client.characterId!)) this.floorQueue.push(client.characterId!);
        this.broadcastFloor();
        return;
      }
      case "activity": { // aggregate Box interaction ping (tab switch etc.) — never content
        this.requireBox(client);
        this.touch(client.characterId!, "taps");
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
      case "interview": {
        if (client.role !== "creator" || !client.interview)
          throw new Error("creator role required");
        const state = client.interview.handle(msg.input as InterviewInput);
        if (client.interview.done) {
          // commit: the engine validates legality one final, authoritative time
          const session = client.interview;
          await this.enqueueTurn(async () => {
            const sheet = this.engine.createCharacter(session.build);
            this.engine.recordBackstory(session.build.id, session.backstory);
            this.builds.set(session.build.id, session.build);
            // rebind: the connection becomes this character's Box (binding is
            // to the character — any device may log back into it later)
            client.role = "box";
            client.characterId = session.build.id;
            client.interview = undefined;
            client.cursor = 0;
            this.sendTo(client, { type: "character_sealed", characterId: session.build.id,
              sheet: { name: sheet.name, class: sheet.class, species: sheet.species } });
            this.sendTo(client, { type: "joined", role: "box", characterId: session.build.id,
              media: this.media.kind });
            // the portrait-anchor moment: distill the story → campaign-style
            // prompt → render (mock: prompt persisted, placeholder face)
            await this.renderPortrait(session.build, session.backstory, 0);
            // the host signs off on new arrivals (Prep-Bench philosophy:
            // nothing enters the table without a human yes)
            this.approvals.push(
              { kind: "character", characterId: session.build.id, status: "pending" },
              { kind: "portrait", characterId: session.build.id, status: "pending" });
            this.broadcastApprovals();
            this.flushAll();
            this.broadcastRoster();
          });
          return;
        }
        this.sendTo(client, { type: "interview_state", ...state });
        return;
      }
      case "pace": { // the ▲/▼ micro-signal: "offer Hermys a token"
        this.requireBox(client);
        const dir = msg.dir === "up" ? "up" : "down";
        this.paceVotes.push({ characterId: client.characterId!, dir, seq: ++this.paceSeq });
        if (this.paceVotes.length > 40) this.paceVotes.shift();
        this.broadcastTableState();
        return;
      }
      case "approve": { // host verdict on a creation/portrait approval
        this.requireHost(client);
        const a = this.approvals.find(x =>
          x.characterId === msg.characterId && x.kind === msg.kind && x.status === "pending");
        if (!a) throw new Error(`no pending ${msg.kind} approval for ${msg.characterId}`);
        a.status = msg.ok ? "approved" : "rejected";
        const box = [...this.clients.values()].find(c => c.role === "box" && c.characterId === a.characterId);
        if (a.kind === "portrait" && !msg.ok) {
          this.rerolls.delete(a.characterId);       // the host re-opens the re-roll
          this.approvals.push({ kind: "portrait", characterId: a.characterId, status: "pending" });
          if (box) this.sendTo(box, { type: "host_note", text: "The host asks for another face — your re-roll is open again." });
        } else if (box) {
          this.sendTo(box, { type: "host_note",
            text: msg.ok ? `${a.kind} approved — welcome to the table.` : `${a.kind} needs another pass.` });
        }
        this.broadcastApprovals();
        return;
      }
      case "portrait_reroll": {
        this.requireBox(client);
        const used = this.rerolls.get(client.characterId!) ?? 0;
        if (used >= 1) { // one free re-roll; beyond that the host decides
          this.sendTo(client, { type: "error", error: "re-roll spent — ask the host" });
          return;
        }
        const build = this.builds.get(client.characterId!);
        if (!build) { this.sendTo(client, { type: "error", error: "no stored build for this character" }); return; }
        const backstory = (this.engine.store.visibleTo(client.characterId!)
          .find(e => e.type === "backstory_recorded")?.payload as any)?.text ?? "";
        await this.enqueueTurn(async () => {
          this.rerolls.set(client.characterId!, used + 1);
          await this.renderPortrait(build, backstory, used + 1);
          this.flushAll();
        });
        return;
      }
      case "cast": {
        this.requireBox(client);
        await this.enqueueTurn(async () => {
          try {
            this.engine.castSpell(client.characterId!, Number(msg.level));
            this.flushAll();
          } catch (e) { // the engine's refusal IS the feature — surface it
            this.sendTo(client, { type: "error", error: String((e as Error).message) });
          }
        });
        return;
      }
      case "use_item": {
        this.requireBox(client);
        await this.enqueueTurn(async () => {
          try {
            this.engine.useItem(client.characterId!, String(msg.itemId));
            this.flushAll();
          } catch (e) {
            this.sendTo(client, { type: "error", error: String((e as Error).message) });
          }
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
      case "grant_levelup": { // the host bestows growth; the engine validates it
        this.requireHost(client);
        const charId = String(msg.characterId);
        const build = this.builds.get(charId);
        if (!build) throw new Error(`no stored build for ${charId} — only interview-born characters level`);
        const c = this.engine.state().combatants[charId];
        if (!c) throw new Error(`unknown character: ${charId}`);
        const box = [...this.clients.values()].find(x => x.role === "box" && x.characterId === charId);
        if (!box) { this.sendTo(client, { type: "error", error: `${charId} has no Box connected` }); return; }
        this.levelOffers.set(charId, c.level + 1);
        const { CLASSES } = await import("../../../engine/src/character.js");
        this.sendTo(box, { type: "levelup_offer", characterId: charId,
          toLevel: c.level + 1, hitDie: CLASSES[build.class].hitDie });
        return;
      }
      case "levelup": { // the Box answers the offer with its HP choice
        this.requireBox(client);
        const charId = client.characterId!;
        const toLevel = this.levelOffers.get(charId);
        if (!toLevel) { this.sendTo(client, { type: "error", error: "no level-up offered" }); return; }
        await this.enqueueTurn(async () => {
          try {
            this.engine.levelUp(charId, toLevel, msg.choice);
            this.levelOffers.delete(charId);
            this.flushAll();
            this.broadcast({ type: "hero_grows", characterId: charId,
              toLevel }); // leveling is table knowledge — the room celebrates
          } catch (e) { // refusal: the offer stands, the Box learns why
            this.sendTo(client, { type: "error", error: String((e as Error).message) });
          }
        });
        return;
      }
      case "run_beat": { // the host turns the page: scene + encounter as events
        this.requireHost(client);
        if (!this.campaign) throw new Error("no campaign loaded");
        await this.enqueueTurn(async () => {
          const beat = runBeat(this.engine, this.campaign!, String(msg.beatId));
          this.flushAll();
          this.broadcastMap();
          this.broadcastFloor();
          // the gm panel goes back to the HOST seat only
          this.sendTo(client, { type: "beat_running", beatId: beat.id, gm: beat.gm ?? null });
        });
        return;
      }
      case "start_combat": { // host control until the Director drives it
        this.requireHost(client);
        await this.enqueueTurn(async () => {
          this.engine.rollInitiativeAll({}, msg.surprised ?? []);
          this.flushAll();
          this.broadcastFloor();
        });
        return;
      }
      case "advance_turn": {
        this.requireHost(client);
        await this.enqueueTurn(async () => {
          this.engine.advanceTurn();
          this.flushAll();
          this.broadcastFloor();
        });
        return;
      }
      default:
        this.sendTo(client, { type: "error", error: `unknown message type: ${msg?.type}` });
    }
  }

  // ----------------------------------------------------------- turn logic
  private async declarationTurn(characterId: string, text: string): Promise<void> {
    this.touch(characterId, "declarations");
    await this.enqueueTurn(async () => {
      this.checkpoints.push(this.tip());
      this.engine.declare(characterId, text);
      this.flushAll();
      const narration = await this.dm.takeTurn(this.engine, { actor: characterId, text });
      await this.deliver(narration);
    });
  }

  /** The fogged map: visited nodes in full, frontier as nameless stubs.
   *  Names of unwalked places never leave the server (the wire enforces
   *  the same secrecy the MiniMap renders). */
  mapPayload(): { nodes: any[]; edges: any[] } | null {
    const world: { locations: Record<string, any>; edges: [string, string][] } | undefined =
      this.campaign ?? (this.dm as EchoDM).scene;
    if (!world?.locations) return null;
    const visited = new Set(this.engine.state().visitedLocations);
    const frontier = new Set(world.edges
      .filter(([a, b]) => visited.has(a) !== visited.has(b))
      .map(([a, b]) => (visited.has(a) ? b : a)));
    return {
      nodes: Object.values(world.locations)
        .filter(l => visited.has(l.id) || frontier.has(l.id))
        .map(l => visited.has(l.id)
          ? { id: l.id, name: l.name, x: l.x, y: l.y, known: true }
          : { id: l.id, x: l.x, y: l.y, known: false }),
      edges: world.edges
        .filter(([a, b]) => visited.has(a) || visited.has(b))
        .map(([a, b]) => ({ from: a, to: b, known: visited.has(a) && visited.has(b) })),
    };
  }

  private lastMapKey = "";
  private broadcastMap(): void {
    const map = this.mapPayload();
    if (!map) return;
    const key = JSON.stringify(map);
    if (key === this.lastMapKey) return;
    this.lastMapKey = key;
    this.broadcast({ type: "map", ...map });
  }

  /** Narration → log → tts → role-gated fan-out (+ roll prompts).
   *  An empty narration means the human host speaks — events still flow. */
  private async deliver(narration: string): Promise<void> {
    if (!narration.trim()) { this.flushAll(); this.broadcastMap(); return; }
    this.engine.recordNarration(narration);
    const speech = await this.media.tts(narration);
    this.flushAll();
    this.broadcastMap();
    this.broadcast({ type: "narration", text: narration,
      durationMs: speech.durationMs, hasAudio: speech.audio !== null });
    for (const p of Object.values(this.engine.state().pendingChecks)) {
      if (p.rolls !== null) continue;
      const box = [...this.clients.values()].find(c => c.role === "box" && c.characterId === p.actor);
      if (box) this.sendTo(box, { type: "roll_request", checkId: p.id, kind: p.kind,
        ability: p.ability, skill: p.skill, modifier: p.modifier, advantage: p.advantage });
    }
  }

  /** Distill → prompt → render → portrait_attached (public: the reveal). */
  private async renderPortrait(build: CharacterBuild, backstory: string, take: number): Promise<void> {
    const block = await this.distiller.distill(build, backstory);
    const { prompt, seed } = buildPortraitPrompt(block, build);
    const finalSeed = (seed + fnv1a(`take/${take}`)) >>> 0;
    const img = await this.media.portrait(prompt, finalSeed);
    this.engine.attachPortrait(build.id, img.url ?? `pending:${finalSeed}`, prompt);
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

  private touch(characterId: string, kind: "ptt" | "declarations" | "taps"): void {
    const t = this.telemetry.get(characterId) ?? { ptt: 0, declarations: 0, taps: 0, lastSeq: 0 };
    t[kind] += 1;
    t.lastSeq = ++this.activitySeq;
    this.telemetry.set(characterId, t);
    this.broadcastTableState();
  }

  /** The Table State vector the Director will read in Phase 4+. */
  tableVector() {
    const players = [...this.clients.values()]
      .filter(c => c.role === "box" && c.characterId)
      .map(c => ({ characterId: c.characterId!,
        ...(this.telemetry.get(c.characterId!) ?? { ptt: 0, declarations: 0, taps: 0, lastSeq: 0 }) }));
    return {
      pace: {
        up: this.paceVotes.filter(v => v.dir === "up").length,
        down: this.paceVotes.filter(v => v.dir === "down").length,
        recent: this.paceVotes.slice(-8),
      },
      players,
      // quietest first: the Director's spotlight queue
      spotlightDebt: [...players].sort((a, b) => a.lastSeq - b.lastSeq).map(p => p.characterId),
    };
  }

  /** Pace + approvals go to the host seat only — table telemetry, not fiction. */
  private broadcastTableState(): void {
    const vector = this.tableVector();
    for (const c of this.clients.values())
      if (c.role === "host") this.sendTo(c, { type: "table_state", ...vector });
  }

  private broadcastApprovals(): void {
    for (const c of this.clients.values())
      if (c.role === "host")
        this.sendTo(c, { type: "approvals", queue: this.approvals.filter(a => a.status === "pending"),
          decided: this.approvals.filter(a => a.status !== "pending").slice(-6) });
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
