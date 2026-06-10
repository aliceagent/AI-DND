<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, sheet, transcript, rollRequests, floor, send, reportRoll, label, mediaKind } from "$lib/client";
  import { Ptt, type PttState } from "$lib/ptt";

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
    // mock mode: the typed line is the transcript; spark consumes the audio
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

  const inQueue = $derived($joined?.characterId != null && $floor.queue.includes($joined.characterId));
</script>

{#if $sheet}
  <header>
    <div>
      <h2>{$sheet.name}</h2>
      <span class="meta">AC {$sheet.ac} · HP {$sheet.hp}/{$sheet.maxHp}
        {#if $sheet.conditions.length} · {$sheet.conditions.join(", ")}{/if}</span>
      {#if $sheet.slots}
        <span class="meta">· slots L1: {$sheet.slots[1] ?? 0}</span>
      {/if}
    </div>
    <button class="xcard" onclick={xcard} title="X-card: rewind, no questions">✕</button>
  </header>
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
  {#if $floor.queue.length}
    <span class="floor">{$floor.mode}: {$floor.queue.map(q => q.replace("pc.", "")).join(" → ")}</span>
  {/if}
</div>

<style>
  header { display: flex; justify-content: space-between; align-items: start; }
  h2 { margin: 0 0 0.2rem; }
  .meta { color: #9b93ab; font-size: 0.9em; }
  .xcard { background: #4d2330; border-color: #7c3a4d; font-weight: 700; }
  .rollpad { background: #2a2440; border: 1px solid #5d5378; border-radius: 12px;
    padding: 0.9rem; margin: 0.8rem 0; }
  .rollrow { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .rollrow input { flex: 1; }
  .log { margin: 1rem 0; max-height: 50dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 0.4rem; }
  .log p { margin: 0; }
  .log .pip { color: #cdbf9a; }
  .talk { position: sticky; bottom: 0; background: #14131c; padding: 0.6rem 0 1rem;
    display: flex; flex-direction: column; gap: 0.5rem; }
  .ptt { padding: 1.1em; font-size: 1.05em; border-radius: 14px;
    background: #2d4a3a; border-color: #4a7c5f; touch-action: none; user-select: none; -webkit-user-select: none; }
  .ptt.held { background: #7c2d2d; border-color: #a04545; }
  .ptt.queued { outline: 2px solid #cdbf9a; }
  .micwarn { color: #d08770; font-size: 0.85em; }
  .floor { color: #9b93ab; font-size: 0.85em; }
</style>
