<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, sheet, journal, transcript, rollRequests, floor, send, reportRoll, label, mediaKind, scene, listeners, combat } from "$lib/client";
  import { sigil } from "$lib/palettes";
  import { a11y, vibrate, HAPTIC } from "$lib/a11y";
  import A11ySheet from "$lib/A11ySheet.svelte";
  import MiniMap from "$lib/MiniMap.svelte";
  import { Ptt, type PttState } from "$lib/ptt";
  import { onMount, onDestroy } from "svelte";

  /** Haptic twins for the room's audio cues — a player who can't hear the
   *  chime feels the narration land, the roll called, the secret arrive. */
  function onMsg(msg: any) {
    if (msg.type === "narration") vibrate(HAPTIC.narration, $a11y);
    if (msg.type === "roll_request") vibrate(HAPTIC.rollCall, $a11y);
    if (msg.type === "events")
      for (const e of msg.events) {
        if (e.type === "fact_revealed" && Array.isArray(e.visibility))
          vibrate(HAPTIC.privateReveal, $a11y);
        if (e.type === "turn_advanced" && e.payload?.active === $joined?.characterId)
          vibrate(HAPTIC.yourTurn, $a11y);
      }
  }
  const myTurn = $derived($combat.started && !$combat.over && $combat.active === $joined?.characterId);
  onMount(() => listeners.add(onMsg));
  onDestroy(() => listeners.delete(onMsg));

  type Tab = "talk" | "sheet" | "gear" | "magic" | "journal" | "map";
  let tab: Tab = $state("talk");
  function switchTab(t: Tab) {
    tab = t;
    send({ type: "activity", kind: "tab" }); // aggregate ping only — never content
  }

  let text = $state("");
  let ptt = new Ptt();
  let pttState: PttState = $state({ recording: false, micOk: null, error: null });
  let rollInputs: Record<number, string> = $state({});

  $effect(() => { if (!$joined) goto("/"); });

  async function pttDown() {
    send({ type: "ptt_start" });
    await ptt.start(s => (pttState = s));
  }

  async function pttUp() {
    await ptt.stop(s => (pttState = s));
    if (text.trim()) {
      send({ type: "ptt_end", text: text.trim() });
      text = "";
    } else {
      send({ type: "ptt_end", text: "(static — say it again or type it)" });
    }
  }

  function declare() {
    if (!text.trim()) return;
    send({ type: "declare", text: text.trim() });
    text = "";
  }

  function submitRoll(checkId: number, advantage: string) {
    const dice = (rollInputs[checkId] ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
    const needed = advantage === "none" ? 1 : 2;
    if (dice.length < needed || dice.some(d => !(d >= 1 && d <= 20))) return;
    reportRoll(checkId, dice.slice(0, needed));
    delete rollInputs[checkId];
  }

  function xcard() {
    if (confirm("X-card: rewind this content? It's anonymous.")) send({ type: "xcard" });
  }

  const dying = $derived(($sheet?.hp === 0) && !$sheet?.conditions.includes("dead")
    && !$sheet?.conditions.includes("stable"));
  const slotLevels = $derived(Object.entries($sheet?.slots ?? {})
    .map(([lvl, max]) => ({ lvl, max: Number(max), used: Number($sheet?.slotsUsed?.[lvl] ?? 0) })));
  const mods = $derived($sheet?.abilities
    ? Object.entries($sheet.abilities).map(([k, v]) => ({
        k: k.toUpperCase(), v: v as number,
        m: Math.floor(((v as number) - 10) / 2) }))
    : []);
  const inQueue = $derived($joined?.characterId != null && $floor.queue.includes($joined.characterId));
</script>

{#if $scene}
  <div class="where"><span>{sigil($scene.location_id)}</span> {$scene.name}</div>
{/if}
<A11ySheet />

{#if $sheet}
  <header>
    <div class="who">
      {#if $sheet.portrait && /^(https?:|data:|\/)/.test($sheet.portrait)}
        <img class="face" src={$sheet.portrait} alt={$sheet.name} />
      {:else if $sheet.portrait}
        <div class="face placeholder brewing" title="portrait prompt saved — renders on the Spark">✶</div>
      {:else}
        <div class="face placeholder">{$sheet.name?.[0] ?? "?"}</div>
      {/if}
      <div>
        <h2>{$sheet.name}</h2>
        <span class="meta">
          {#if $sheet.species}{$sheet.species} {$sheet.class} {($sheet.level ?? 1) > 0 ? `· lvl ${$sheet.level ?? 1}` : ""} · {/if}
          AC {$sheet.ac} · HP {$sheet.hp}/{$sheet.maxHp}
          {#if $sheet.conditions.length} · {$sheet.conditions.join(", ")}{/if}
        </span>
      </div>
    </div>
    <button class="xcard" onclick={xcard} title="X-card: rewind, no questions">✕</button>
  </header>

  {#if dying}
    <div class="dying">
      <strong>Dying.</strong>
      <span class="pips">
        {#each [0, 1, 2] as i}<span class:on={$sheet.deathSaves.successes > i}>●</span>{/each}
        saves ·
        {#each [0, 1, 2] as i}<span class="bad" class:on={$sheet.deathSaves.failures > i}>●</span>{/each}
        fails
      </span>
      <span class="hint">roll a d20 when called — Pip is watching</span>
    </div>
  {/if}
{/if}

{#if myTurn}
  <div class="yourturn">⚔ YOUR TURN<span> — round {$combat.round}</span></div>
{/if}

{#each $rollRequests as r (r.checkId)}
  <div class="rollpad">
    <strong>Roll d20 — {label(r)}</strong>
    <div class="rollrow">
      <input inputmode="numeric" placeholder={r.advantage === "none" ? "d20" : "d20, d20"}
        bind:value={rollInputs[r.checkId]} />
      <button onclick={() => submitRoll(r.checkId, r.advantage)}>Report</button>
    </div>
  </div>
{/each}

<nav class="tabs">
  {#each ["talk", "sheet", "gear", "magic", "journal", "map"] as t}
    <button class:active={tab === t} onclick={() => switchTab(t as Tab)}>{t}</button>
  {/each}
</nav>

{#if tab === "talk"}
  <section class="log">
    {#each $transcript as line (line.id)}
      <p class:pip={line.who === "Pip"}><b>{line.who === "Pip" ? "Pip" : line.who.replace("pc.", "")}</b> {line.text}</p>
    {/each}
  </section>

  <div class="talk">
    <input placeholder={$mediaKind === "mock" ? "type your declaration (mock STT)" : "optional note"}
      bind:value={text} onkeydown={e => e.key === "Enter" && declare()} />
    <button class="ptt" class:held={pttState.recording} class:queued={inQueue}
      onpointerdown={pttDown} onpointerup={pttUp} onpointercancel={pttUp}>
      {pttState.recording ? "● release to send" : "hold to talk"}
    </button>
    {#if pttState.micOk === false}
      <span class="micwarn">mic: {pttState.error}</span>
    {/if}
    <div class="pace">
      <span>offer Hermys a token</span>
      <button class="mini" title="more, faster" onclick={() => send({ type: "pace", dir: "up" })}>▲</button>
      <button class="mini" title="ease up" onclick={() => send({ type: "pace", dir: "down" })}>▼</button>
    </div>
    {#if $floor.queue.length}
      <span class="floorline">{$floor.mode}: {$floor.queue.map(q => q.replace("pc.", "")).join(" → ")}</span>
    {/if}
  </div>

{:else if tab === "sheet" && $sheet}
  <section class="panel">
    {#if mods.length}
      <div class="abilities">
        {#each mods as a}
          <div class="ab"><span class="k">{a.k}</span><span class="v">{a.v}</span>
            <span class="m">{a.m >= 0 ? "+" : ""}{a.m}</span></div>
        {/each}
      </div>
    {:else}
      <p class="hint">A pre-made sheet — full abilities appear for characters born in the interview.</p>
    {/if}
    {#if $sheet.skills?.length}
      <p><b>Trained:</b> {$sheet.skills.map((s: string) => s.replace(/_/g, " ")).join(", ")}</p>
    {/if}
    {#if $sheet.saves?.length}
      <p><b>Saves:</b> {$sheet.saves.join(", ").toUpperCase()}</p>
    {/if}
    {#if $sheet.passivePerception}
      <p><b>Passive perception:</b> {$sheet.passivePerception} · <b>Speed:</b> {$sheet.speed} ft · <b>Armor:</b> {$sheet.armorName}</p>
    {/if}
    {#if $sheet.traits?.length}
      <p><b>Traits:</b> {$sheet.traits.join(", ")}</p>
    {/if}
    {#if $sheet.hitDice}
      <p><b>Hit dice:</b> d{$sheet.hitDice.die} × {$sheet.hitDice.count}</p>
    {/if}
    {#if $sheet.portrait}
      <button class="mini" onclick={() => send({ type: "portrait_reroll" })}>new face (one re-roll)</button>
    {/if}
  </section>

{:else if tab === "gear" && $sheet}
  <section class="panel">
    {#each $sheet.inventory as item (item.id)}
      <div class="item">
        <span>{item.name}</span>
        <button class="mini" onclick={() => send({ type: "use_item", itemId: item.id })}>use</button>
      </div>
    {:else}
      <p class="hint">Nothing carried yet — the world provides.</p>
    {/each}
  </section>

{:else if tab === "magic" && $sheet}
  <section class="panel">
    {#each slotLevels as s (s.lvl)}
      <div class="slotrow">
        <span>Level {s.lvl}</span>
        <span class="pips">
          {#each Array(s.max) as _, i}<span class:on={i >= s.used}>◆</span>{/each}
        </span>
        <button class="mini" onclick={() => send({ type: "cast", level: Number(s.lvl) })}
          disabled={s.used >= s.max}>cast</button>
      </div>
    {:else}
      <p class="hint">No spell slots — your magic is steel.</p>
    {/each}
  </section>

{:else if tab === "map"}
  <section class="panel mappanel">
    {#if $scene}
      <MiniMap visited={$scene.visited} currentId={$scene.location_id} />
      <p class="hint">you are at {$scene.name} — the dark holds what you haven't walked</p>
    {:else}
      <p class="hint">No ground beneath your feet yet.</p>
    {/if}
  </section>

{:else if tab === "journal"}
  <section class="panel">
    {#each $journal as entry (entry.id)}
      <p class="entry" class:secret={entry.private}>
        <b>{entry.kind}</b> {entry.text}
        {#if entry.private}<span class="lock">only you</span>{/if}
      </p>
    {:else}
      <p class="hint">The story hasn't told you anything yet.</p>
    {/each}
  </section>
{/if}

<style>
  .where { color: #cdbf9a; font-size: 0.88em; margin-bottom: 0.5rem;
    display: flex; gap: 0.45em; align-items: center; }
  header { display: flex; justify-content: space-between; align-items: start; }
  .who { display: flex; gap: 0.8rem; align-items: center; }
  .face { width: 52px; height: 52px; border-radius: 12px; object-fit: cover; }
  .face.placeholder { background: #4a3f6b; display: flex; align-items: center;
    justify-content: center; font-size: 1.5em; font-weight: 700; }
  .face.brewing { background: #2a2440; color: #cdbf9a; border: 1px dashed #5d5378; }
  h2 { margin: 0 0 0.2rem; }
  .meta { color: #9b93ab; font-size: 0.9em; }
  .xcard { background: #4d2330; border-color: #7c3a4d; font-weight: 700; }
  .yourturn { background: #2a2440; border: 2px solid #cdbf9a; border-radius: 12px;
    padding: 0.7rem 1rem; margin-top: 0.6rem; text-align: center; font-weight: 700;
    font-size: 1.15em; color: #f0ead8; letter-spacing: 0.04em;
    animation: turnpulse 1.6s ease-in-out infinite; }
  .yourturn span { color: #9b93ab; font-weight: 400; font-size: 0.8em; }
  @keyframes turnpulse { 50% { box-shadow: 0 0 18px #cdbf9a55; } }
  @media (prefers-reduced-motion: reduce) { .yourturn { animation: none; } }
  .dying { background: #3d2330; border: 1px solid #a04545; border-radius: 10px;
    padding: 0.6rem 0.9rem; margin-top: 0.6rem; display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap; }
  .pips span { opacity: 0.25; margin-right: 0.1em; }
  .pips span.on { opacity: 1; color: #9fd49f; }
  .pips span.bad.on { color: #d08770; }
  .tabs { display: flex; gap: 0.4rem; margin: 0.9rem 0 0.6rem; }
  .tabs button { padding: 0.4em 0.9em; font-size: 0.9em; text-transform: capitalize;
    background: #1d1b27; }
  .tabs button.active { background: #4a3f6b; border-color: #6b5e93; }
  .rollpad { background: #2a2440; border: 1px solid #5d5378; border-radius: 12px;
    padding: 0.9rem; margin: 0.8rem 0; }
  .rollrow { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .rollrow input { flex: 1; }
  .log { margin: 0.4rem 0 1rem; max-height: 44dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; }
  .log p { margin: 0; }
  .log .pip { color: #cdbf9a; }
  .talk { position: sticky; bottom: 0; background: #14131c; padding: 0.6rem 0 1rem;
    display: flex; flex-direction: column; gap: 0.5rem; }
  .ptt { padding: 1.1em; font-size: 1.05em; border-radius: 14px;
    background: #2d4a3a; border-color: #4a7c5f; touch-action: none; user-select: none; -webkit-user-select: none; }
  .ptt.held { background: #7c2d2d; border-color: #a04545; }
  .ptt.queued { outline: 2px solid #cdbf9a; }
  .micwarn { color: #d08770; font-size: 0.85em; }
  .floorline { color: #9b93ab; font-size: 0.85em; }
  .pace { display: flex; gap: 0.5rem; align-items: center; color: #6f687f; font-size: 0.85em; }
  .panel { display: flex; flex-direction: column; gap: 0.55rem; }
  .mappanel { background: #16141f; border: 1px solid #353044; border-radius: 14px;
    padding: 0.8rem; aspect-ratio: 10 / 7; }
  .abilities { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
  .ab { background: #1d1b27; border: 1px solid #353044; border-radius: 10px;
    padding: 0.5rem; display: flex; flex-direction: column; align-items: center; }
  .ab .k { color: #9b93ab; font-size: 0.75em; }
  .ab .v { font-size: 1.3em; font-weight: 600; }
  .ab .m { color: #cdbf9a; }
  .item, .slotrow { display: flex; justify-content: space-between; align-items: center;
    background: #1d1b27; border: 1px solid #353044; border-radius: 10px; padding: 0.55rem 0.8rem; }
  .slotrow .pips { font-size: 1.1em; }
  .slotrow .pips span.on { color: #8fb7d4; }
  .mini { padding: 0.25em 0.8em; font-size: 0.85em; }
  .entry { margin: 0; }
  .entry.secret { color: #cdbf9a; }
  .lock { color: #6f687f; font-size: 0.8em; margin-left: 0.4em; }
  .hint { color: #6f687f; }
  p { margin: 0; }
</style>
