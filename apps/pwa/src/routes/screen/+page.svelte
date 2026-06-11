<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, transcript, narrations, floor, roster, listeners, scene } from "$lib/client";
  import { mixer } from "$lib/mixer";
  import { backdrop, sigil } from "$lib/palettes";
  import { onMount, onDestroy } from "svelte";

  let audioOn = $state(false);
  let volume = $state(0.8);
  let reveal: { name: string; asset: string } | null = $state(null);
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** The establishing moment: scene_set → full-bleed arrival card. */
  let establishing: { name: string; locationId: string; mood: string | null; palette: string | null } | null = $state(null);
  let establishingTimer: ReturnType<typeof setTimeout> | null = null;
  const reducedMotion = typeof matchMedia !== "undefined"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;

  $effect(() => { if (!$joined) goto("/"); });

  const latest = $derived($narrations.at(-1)?.text ?? "");
  const bd = $derived(backdrop($scene?.palette));

  function onMessage(msg: any) {
    if (msg.type === "narration" && mixer.running) {
      mixer.duck(msg.durationMs);
      if (!msg.hasAudio) mixer.chime(); // mock TTS: cue the room anyway
    }
    if (msg.type === "events")
      for (const e of msg.events) {
        if (e.type === "scene_set") { // the arrival is a produced moment
          establishing = { name: e.payload.name, locationId: e.payload.location_id,
            mood: e.payload.mood ?? null, palette: e.payload.palette ?? null };
          if (mixer.running) mixer.chime();
          if (establishingTimer) clearTimeout(establishingTimer);
          establishingTimer = setTimeout(() => (establishing = null), reducedMotion ? 2500 : 5000);
        }
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

<div class="backdrop" style={`background-image:${bd.gradient}`}></div>

{#if $scene}
  <div class="locbanner" style={`--glow:${bd.glow}`}>
    <span class="sig">{sigil($scene.location_id)}</span> {$scene.name}
    {#if $scene.mood}<span class="mood">{$scene.mood}</span>{/if}
  </div>
{/if}

{#if establishing}
  {@const ebd = backdrop(establishing.palette)}
  <div class="establishing" class:rm={reducedMotion} style={`background-image:${ebd.gradient}; --glow:${ebd.glow}`}>
    <span class="esigil">{sigil(establishing.locationId)}</span>
    <h1>{establishing.name}</h1>
    {#if establishing.mood}<p class="emood">{establishing.mood.replace(/-/g, " ")}</p>{/if}
  </div>
{/if}

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
  .backdrop { position: fixed; inset: 0; z-index: -1; opacity: 0.85;
    transition: background-image 1.2s ease; }
  .locbanner { position: fixed; top: 0.9rem; left: 1.1rem; z-index: 5;
    background: #14131ccc; border: 1px solid #353044; border-radius: 999px;
    padding: 0.35em 1em; color: #e8dfc8; backdrop-filter: blur(6px);
    display: flex; gap: 0.5em; align-items: center; }
  .locbanner .sig { color: var(--glow); }
  .locbanner .mood { color: #9b93ab; font-size: 0.82em; font-style: italic; }
  .establishing { position: fixed; inset: 0; z-index: 40;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1rem; animation: estab-in 1.4s ease-out, estab-out 0.9s ease-in 4.1s forwards; }
  .establishing.rm { animation: none; }
  .esigil { font-size: 4.5em; color: var(--glow); text-shadow: 0 0 42px var(--glow);
    animation: sigil-rise 2.2s ease-out; }
  .establishing.rm .esigil { animation: none; }
  .establishing h1 { font-size: 3.2em; letter-spacing: 0.06em; margin: 0;
    color: #f0ead8; text-shadow: 0 2px 30px #000c; text-align: center; }
  .emood { color: var(--glow); letter-spacing: 0.25em; text-transform: uppercase;
    font-size: 0.95em; margin: 0; }
  @keyframes estab-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes estab-out { to { opacity: 0; visibility: hidden; } }
  @keyframes sigil-rise { from { transform: translateY(14px); opacity: 0; } }
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
