<script lang="ts">
  /** The creation interview (charcreate-box-plan §B): voice-first at the
   *  table, chips-first here — the server's step machine drives; this view
   *  just renders the current frame and sends one input at a time. */
  import { goto } from "$app/navigation";
  import { joined, interview, send, mediaKind } from "$lib/client";
  import { Ptt, type PttState } from "$lib/ptt";

  let text = $state("");
  let ptt = new Ptt();
  let pttState: PttState = $state({ recording: false, micOk: null, error: null });
  let picked: string[] = $state([]);                 // skills multi-select
  let assign: Record<string, number | null> = $state({ str: null, dex: null, con: null, int: null, wis: null, cha: null });

  const ARRAY = [15, 14, 13, 12, 10, 8];

  $effect(() => { if ($joined?.role === "box") goto("/box"); });
  $effect(() => { if (!$joined) goto("/"); });
  $effect(() => { void $interview?.step; picked = []; }); // reset selections per step

  function sendInput(input: unknown) {
    send({ type: "interview", input });
    text = "";
  }

  async function pttDown() { await ptt.start(s => (pttState = s)); }
  async function pttUp() {
    await ptt.stop(s => (pttState = s));
    if (text.trim()) sendInput({ text: text.trim() });
  }

  function togglePick(id: string, max: number) {
    picked = picked.includes(id) ? picked.filter(x => x !== id)
           : picked.length < max ? [...picked, id] : picked;
  }

  const skillMax = $derived(Number($interview?.prompt?.match(/Pick (\d+)/)?.[1] ?? 2));
  const remaining = $derived(ARRAY.filter(v =>
    !Object.values(assign).filter(Boolean).includes(v)));
  const assignDone = $derived(Object.values(assign).every(v => v !== null));
</script>

{#if $interview}
  <header class="crown">
    <h2>Begin your legend</h2>
    {#if $interview.total}
      <div class="trail" aria-label={`question ${$interview.index + 1} of ${$interview.total}`}>
        {#each Array($interview.total) as _, i}
          <span class="dot" class:lit={i <= $interview.index}></span>
        {/each}
      </div>
    {/if}
  </header>
  {#if $interview.canBack}
    <button class="back" onclick={() => sendInput({ back: true })}>← back</button>
  {/if}
  <p class="ask">{$interview.prompt}</p>
  {#if $interview.error}<p class="err">{$interview.error}</p>{/if}

  {#if $interview.expect === "text"}
    <div class="textin">
      <textarea rows={$interview.step === "backstory" ? 5 : 1}
        placeholder={$mediaKind === "mock" ? "type it (mock voice)" : "or type it"}
        bind:value={text}></textarea>
      <div class="row">
        <button class="ptt" class:held={pttState.recording}
          onpointerdown={pttDown} onpointerup={pttUp} onpointercancel={pttUp}>
          {pttState.recording ? "● release" : "hold to talk"}
        </button>
        <button class="go" onclick={() => text.trim() && sendInput({ text: text.trim() })}>Send</button>
      </div>
      {#if pttState.micOk === false}<span class="micwarn">mic: {pttState.error}</span>{/if}
    </div>

  {:else if $interview.expect === "choice" || $interview.expect === "bonus"}
    <div class="chips">
      {#each $interview.chips as c (c.id)}
        <button class="chip" onclick={() => sendInput({ choice: c.id })}>
          <b>{c.label}</b>
          {#if c.hint}<span>{c.hint}</span>{/if}
        </button>
      {/each}
    </div>

  {:else if $interview.expect === "abilities"}
    <div class="assign">
      {#each Object.keys(assign) as k (k)}
        <label class="slot">
          <span>{k.toUpperCase()}</span>
          <select bind:value={assign[k]}>
            <option value={null}>—</option>
            {#each ARRAY as v}
              <option value={v} disabled={Object.entries(assign).some(([ok, ov]) => ov === v && ok !== k)}>{v}</option>
            {/each}
          </select>
        </label>
      {/each}
    </div>
    <button class="go" disabled={!assignDone}
      onclick={() => sendInput({ abilities: { ...assign } })}>Place them</button>

  {:else if $interview.expect === "skills"}
    <div class="chips">
      {#each $interview.chips as c (c.id)}
        <button class="chip" class:on={picked.includes(c.id)}
          onclick={() => togglePick(c.id, skillMax)}>{c.label}</button>
      {/each}
    </div>
    <button class="go" disabled={picked.length !== skillMax}
      onclick={() => sendInput({ skills: picked })}>Train them ({picked.length}/{skillMax})</button>

  {:else if $interview.expect === "confirm"}
    {#if $interview.preview}
      {@const p = $interview.preview}
      <div class="preview">
        <h3>{p.name}</h3>
        <p>{p.species} {p.class} ({p.background}) · level {p.level}</p>
        <p>AC {p.ac} ({p.armorName}) · HP {p.maxHp} · speed {p.speed} ft</p>
        <p class="grid">{#each Object.entries(p.finalAbilities) as [k, v]}<span>{k.toUpperCase()} {v}</span>{/each}</p>
        <p>trained: {p.skills.join(", ").replace(/_/g, " ")}</p>
        <p>{p.attacks[0].name} +{p.attacks[0].toHit}, {p.attacks[0].damage}</p>
      </div>
    {/if}
    <button class="go seal" onclick={() => sendInput({ confirm: true })}>Seal it</button>
  {/if}
{:else}
  <p class="ask">Joining the table…</p>
{/if}

<style>
  .crown { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .crown h2 { margin: 0.4rem 0; }
  .trail { display: flex; gap: 0.3rem; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #353044; }
  .dot.lit { background: #cdbf9a; }
  .back { background: none; border: none; color: #9b93ab; padding: 0.2em 0;
    font-size: 0.92em; cursor: pointer; }
  .ask { font-size: 1.15em; color: #e8dfc8; }
  .err { color: #d08770; }
  .textin { display: flex; flex-direction: column; gap: 0.6rem; }
  textarea { background: #1d1b27; color: #e8e4da; border: 1px solid #494159;
    border-radius: 10px; padding: 0.7em; font-size: 1em; resize: vertical; }
  .row { display: flex; gap: 0.6rem; }
  .ptt { flex: 1; padding: 0.9em; border-radius: 12px; background: #2d4a3a;
    border-color: #4a7c5f; touch-action: none; user-select: none; -webkit-user-select: none; }
  .ptt.held { background: #7c2d2d; border-color: #a04545; }
  .micwarn { color: #d08770; font-size: 0.85em; }
  .chips { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin: 0.8rem 0; }
  .chip { display: flex; flex-direction: column; gap: 0.25rem; text-align: left;
    padding: 0.8em; border-radius: 12px; }
  .chip span { color: #9b93ab; font-size: 0.8em; }
  .chip.on { outline: 2px solid #cdbf9a; background: #3a3450; }
  .assign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; margin: 0.8rem 0; }
  .slot { display: flex; flex-direction: column; gap: 0.3rem; color: #9b93ab; }
  .go { background: #4a3f6b; border-color: #6b5e93; font-weight: 600; width: 100%; padding: 0.9em; }
  .go:disabled { opacity: 0.45; }
  .seal { background: #2d4a3a; border-color: #4a7c5f; }
  .preview { background: #1d1b27; border: 1px solid #4a7c5f; border-radius: 14px;
    padding: 1rem; margin-bottom: 0.8rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .preview h3, .preview p { margin: 0; }
  .grid { display: flex; gap: 0.8em; flex-wrap: wrap; color: #cdbf9a; }
</style>
