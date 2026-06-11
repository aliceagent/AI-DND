<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, transcript, narrations, floor, roster, listeners } from "$lib/client";
  import { mixer } from "$lib/mixer";
  import { onMount, onDestroy } from "svelte";

  let audioOn = $state(false);
  let volume = $state(0.8);
  let reveal: { name: string; asset: string } | null = $state(null);
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => { if (!$joined) goto("/"); });

  const latest = $derived($narrations.at(-1)?.text ?? "");

  function onMessage(msg: any) {
    if (msg.type === "narration" && mixer.running) {
      mixer.duck(msg.durationMs);
      if (!msg.hasAudio) mixer.chime(); // mock TTS: cue the room anyway
    }
    if (msg.type === "events")
      for (const e of msg.events) {
        if (e.type === "check_resolved" && e.payload?.outcome && mixer.running)
          mixer.sting(e.payload.outcome === "success");
        if (e.type === "portrait_attached") { // the "this is you" moment
          const id = String(e.payload?.target ?? "");
          reveal = { name: id.replace(/^pc\./, "").replace(/_/g, " "), asset: e.payload?.asset ?? "" };
          if (mixer.running) mixer.chime();
          if (revealTimer) clearTimeout(revealTimer);
          revealTimer = setTimeout(() => (reveal = null), 9000);
        }
      }
  }

  onMount(() => listeners.add(onMessage));
  onDestroy(() => listeners.delete(onMessage));

  function enableAudio() {
    mixer.ensure();
    audioOn = true;
  }

  async function pickMusic(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await mixer.playMusic(file);
  }
</script>

<div class="stage">
  {#if reveal}
    <div class="reveal">
      {#if /^(https?:|data:|\/)/.test(reveal.asset)}
        <img src={reveal.asset} alt={reveal.name} />
      {:else}
        <div class="sigil">✶</div>
      {/if}
      <p class="thisis">This is <b>{reveal.name}</b>.</p>
    </div>
  {/if}
  <p class="narration">{latest || "The table is set. Pip clears his throat…"}</p>

  <div class="transcript">
    {#each $transcript.slice(-8) as line (line.id)}
      <p class:pip={line.who === "Pip"}><b>{line.who === "Pip" ? "Pip" : line.who.replace("pc.", "")}</b> {line.text}</p>
    {/each}
  </div>

  {#if $floor.queue.length}
    <div class="floor">{$floor.mode === "combat" ? "⚔" : "✦"} {$floor.queue.map(q => q.replace("pc.", "")).join(" → ")}</div>
  {/if}
</div>

<footer>
  {#if !audioOn}
    <button onclick={enableAudio}>enable room audio</button>
  {:else}
    <label class="mix">music bed <input type="file" accept="audio/*" onchange={pickMusic} /></label>
    <label class="mix">volume <input type="range" min="0" max="1" step="0.05" bind:value={volume}
      oninput={() => mixer.setMusicVolume(volume)} /></label>
  {/if}
  <span class="roster">{$roster.filter(r => r.role === "box").length} boxes · {$roster.length} clients</span>
</footer>

<style>
  .stage { min-height: 70dvh; display: flex; flex-direction: column; justify-content: center; gap: 2rem; }
  .reveal { display: flex; align-items: center; gap: 1.2rem; background: #1d1b27;
    border: 1px solid #5d5378; border-radius: 16px; padding: 1rem 1.4rem;
    animation: rise 0.4s ease-out; }
  .reveal img, .reveal .sigil { width: 96px; height: 96px; border-radius: 14px; object-fit: cover; }
  .reveal .sigil { background: #2a2440; border: 1px dashed #5d5378; color: #cdbf9a;
    display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
  .thisis { font-size: 1.4em; color: #e8dfc8; margin: 0; text-transform: capitalize; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  .narration { font-size: 1.7em; line-height: 1.5; color: #e8dfc8; text-wrap: balance; }
  .transcript { color: #8d8599; font-size: 0.95em; display: flex; flex-direction: column; gap: 0.3rem; }
  .transcript p { margin: 0; }
  .transcript .pip { color: #b3a87f; }
  .floor { color: #cdbf9a; letter-spacing: 0.03em; }
  footer { display: flex; gap: 1.2rem; align-items: center; flex-wrap: wrap;
    border-top: 1px solid #2b2738; padding-top: 0.8rem; }
  .mix { display: flex; gap: 0.4rem; align-items: center; color: #9b93ab; font-size: 0.9em; }
  .roster { margin-left: auto; color: #6f687f; font-size: 0.85em; }
</style>
