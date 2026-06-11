<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, transcript, narrations, floor, roster, listeners, scene, combat } from "$lib/client";
  import { mixer } from "$lib/mixer";
  import { backdrop, sigil } from "$lib/palettes";
  import { a11y, motionReduced } from "$lib/a11y";
  import A11ySheet from "$lib/A11ySheet.svelte";
  import MiniMap from "$lib/MiniMap.svelte";
  import { onMount, onDestroy } from "svelte";

  let audioOn = $state(false);
  let volume = $state(0.8);
  let reveal: { name: string; asset: string } | null = $state(null);
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** The establishing moment: scene_set → full-bleed arrival card. */
  let establishing: { name: string; locationId: string; mood: string | null; palette: string | null } | null = $state(null);
  let establishingTimer: ReturnType<typeof setTimeout> | null = null;
  const reducedMotion = $derived(motionReduced($a11y));
  /** The caption band: every spoken word, readable across the room. */
  let caption: { speaker: string; text: string } | null = $state(null);
  let captionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bracketed visual twin for every sound cue (audio/visual parity). */
  let sfxCue: string | null = $state(null);
  let sfxTimer: ReturnType<typeof setTimeout> | null = null;
  /** Map inset: shown briefly on travel so the room re-orients. */
  let mapInset = $state(false);
  let mapTimer: ReturnType<typeof setTimeout> | null = null;
  /** X-card: a calm, unhurried reset — never jarring, never attributed. */
  let xcardMoment = $state(false);
  let xcardTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ambient drift: deterministic particle field, palette-tinted. */
  const PARTICLES = Array.from({ length: 14 }, (_, i) => ({
    left: ((i * 37) % 100), delay: -((i * 1.7) % 18), dur: 14 + (i % 5) * 3,
    size: 2 + (i % 3),
  }));

  function cue(text: string) {
    sfxCue = text;
    if (sfxTimer) clearTimeout(sfxTimer);
    sfxTimer = setTimeout(() => (sfxCue = null), 2600);
  }

  $effect(() => { if (!$joined) goto("/"); });

  const latest = $derived($narrations.at(-1)?.text ?? "");
  const bd = $derived(backdrop($scene?.palette));

  function onMessage(msg: any) {
    if (msg.type === "xcard_rewound") {
      xcardMoment = true;
      cue("[the thread of fate frays and reweaves]");
      if (xcardTimer) clearTimeout(xcardTimer);
      xcardTimer = setTimeout(() => (xcardMoment = false), reducedMotion ? 2500 : 5000);
    }
    if (msg.type === "narration") {
      if (mixer.running) {
        mixer.duck(msg.durationMs);
        if (!msg.hasAudio) mixer.chime(); // mock TTS: cue the room anyway
      }
      // the caption is unconditional — sound is the optional channel
      const m = String(msg.text ?? "").match(/^\[voice:([\w.-]+)\]\s*(.*)$/s);
      caption = m ? { speaker: m[1].replace(/^npc\./, "").replace(/_/g, " "), text: m[2] }
                  : { speaker: "Pip", text: msg.text };
      if (captionTimer) clearTimeout(captionTimer);
      captionTimer = setTimeout(() => (caption = null), Math.max(4500, msg.durationMs + 1500));
    }
    if (msg.type === "events")
      for (const e of msg.events) {
        if (e.type === "scene_set") { // the arrival is a produced moment
          establishing = { name: e.payload.name, locationId: e.payload.location_id,
            mood: e.payload.mood ?? null, palette: e.payload.palette ?? null };
          if (mixer.running) mixer.chime();
          cue(`[arriving — ${e.payload.name}]`);
          if (establishingTimer) clearTimeout(establishingTimer);
          establishingTimer = setTimeout(() => (establishing = null), reducedMotion ? 2500 : 5000);
          mapInset = true;
          if (mapTimer) clearTimeout(mapTimer);
          mapTimer = setTimeout(() => (mapInset = false), 10000);
        }
        if (e.type === "check_resolved" && e.payload?.outcome) {
          if (mixer.running) mixer.sting(e.payload.outcome === "success");
          cue(e.payload.outcome === "success" ? "[the roll lands — success]" : "[the roll falls short]");
        }
        if (e.type === "combat_started") cue("[steel is drawn — initiative]");
        if (e.type === "combat_ended") cue("[the fight is over]");
        if (e.type === "portrait_attached") { // the "this is you" moment
          const id = String(e.payload?.target ?? "");
          reveal = { name: id.replace(/^pc\./, "").replace(/_/g, " "), asset: e.payload?.asset ?? "" };
          if (mixer.running) mixer.chime();
          if (revealTimer) clearTimeout(revealTimer);
          revealTimer = setTimeout(() => (reveal = null), 9000);
        }
      }
  }

  onMount(() => {
    listeners.add(onMessage);
    // joins and reconnects: the latest narration arrives as a caught-up
    // event, not a live message — seed the caption band from the fold
    const last = $transcript.filter(l => l.who === "Pip").at(-1);
    if (last) onMessage({ type: "narration", text: last.text,
      durationMs: Math.max(2000, last.text.split(/\s+/).length / 150 * 60000), hasAudio: false });
  });
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

{#if !reducedMotion}
  <div class="drift" aria-hidden="true">
    {#each PARTICLES as p, i (i)}
      <span style={`left:${p.left}%; animation-delay:${p.delay}s; animation-duration:${p.dur}s;
        width:${p.size}px; height:${p.size}px; background:${bd.particle}`}></span>
    {/each}
  </div>
{/if}

{#if xcardMoment}
  <div class="xcard-moment" class:rm={reducedMotion}>
    <p>the thread of fate frays and reweaves…</p>
  </div>
{/if}

{#if $scene}
  <div class="locbanner" style={`--glow:${bd.glow}`}>
    <span class="sig">{sigil($scene.location_id)}</span> {$scene.name}
    {#if $scene.mood}<span class="mood">{$scene.mood}</span>{/if}
  </div>
{/if}

{#if $combat.started && !$combat.over}
  <div class="hud" style={`--glow:${bd.glow}`}>
    <span class="round">round {$combat.round}</span>
    {#each $combat.order as id (id)}
      {@const name = $combat.names[id] ?? id.replace(/^pc\./, "")}
      {@const tier = $combat.tiers[id]}
      <span class="unit" class:active={$combat.active === id} class:down={$combat.dead.has(id)}>
        {name}
        {#if $combat.dead.has(id)}<span class="tier">✝</span>
        {:else if tier}<span class="tier t-{tier}">{tier}</span>{/if}
      </span>
    {/each}
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

{#if sfxCue}
  <div class="sfxcue" class:hc={$a11y.highContrast}>{sfxCue}</div>
{/if}

{#if mapInset && $scene}
  <div class="mapinset">
    <MiniMap visited={$scene.visited} currentId={$scene.location_id} glow={bd.glow} />
  </div>
{/if}

{#if $a11y.captions && caption}
  <div class="captions" class:large={$a11y.captionSize === "large"} class:hc={$a11y.highContrast}
       role="region" aria-live="polite" aria-label="captions">
    <b>{caption.speaker}</b> {caption.text}
  </div>
{/if}

<A11ySheet />

<style>
  .backdrop { position: fixed; inset: 0; z-index: -1; opacity: 0.85;
    transition: background-image 1.2s ease; }
  .drift { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .drift span { position: absolute; bottom: -8px; border-radius: 50%; opacity: 0.3;
    animation: drift-up linear infinite; }
  @keyframes drift-up {
    from { transform: translateY(0) translateX(0); opacity: 0; }
    12% { opacity: 0.35; }
    88% { opacity: 0.25; }
    to { transform: translateY(-105vh) translateX(4vw); opacity: 0; }
  }
  .xcard-moment { position: fixed; inset: 0; z-index: 80; background: #050409f2;
    display: flex; align-items: center; justify-content: center;
    animation: xfade 5s ease forwards; }
  .xcard-moment.rm { animation: none; }
  .xcard-moment p { color: #9b93ab; font-size: 1.6em; font-style: italic;
    letter-spacing: 0.06em; }
  @keyframes xfade { 0% { opacity: 0; } 12% { opacity: 1; } 78% { opacity: 1; } 100% { opacity: 0; } }
  .stage { position: relative; z-index: 1; }
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
  @media (max-width: 900px) { .hud { top: 3.6rem !important; } }
  .hud { position: fixed; top: 0.9rem; left: 50%; transform: translateX(-50%);
    z-index: 6; display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap;
    justify-content: center; max-width: 80vw;
    background: #14131ccc; border: 1px solid #353044; border-radius: 999px;
    padding: 0.3em 0.9em; backdrop-filter: blur(6px); }
  .hud .round { color: #9b93ab; font-size: 0.8em; margin-right: 0.3em;
    text-transform: uppercase; letter-spacing: 0.12em; }
  .hud .unit { color: #b6aec7; font-size: 0.92em; padding: 0.12em 0.6em;
    border-radius: 999px; border: 1px solid transparent; }
  .hud .unit.active { color: #f0ead8; border-color: var(--glow);
    background: #2a2440; box-shadow: 0 0 14px #0008; }
  .hud .unit.down { opacity: 0.45; text-decoration: line-through; }
  .hud .tier { font-size: 0.78em; margin-left: 0.4em; font-style: italic; }
  .hud .t-unhurt { color: #9fd49f; } .hud .t-scratched { color: #cdd9a3; }
  .hud .t-bloodied { color: #e0b35c; } .hud .t-staggering { color: #d08770; }
  .hud .t-down { color: #a04545; }
  .captions { position: fixed; left: 50%; bottom: 1.1rem; transform: translateX(-50%);
    z-index: 50; max-width: min(92vw, 60rem); background: #0a0910d9;
    border: 1px solid #353044; border-radius: 12px; padding: 0.6em 1.1em;
    font-size: 1.35em; line-height: 1.45; color: #f2eee2; text-align: center;
    backdrop-filter: blur(4px); }
  .captions b { color: #cdbf9a; margin-right: 0.45em; }
  .captions.large { font-size: 1.9em; }
  .captions.hc { background: #000; border-color: #fff; color: #fff; }
  .captions.hc b { color: #ffe9a8; }
  .mapinset { position: fixed; right: 1.2rem; bottom: 5.4rem; z-index: 30;
    width: 15rem; aspect-ratio: 10 / 7; background: #14131cd9;
    border: 1px solid #353044; border-radius: 14px; padding: 0.5rem;
    backdrop-filter: blur(6px); animation: rise 0.4s ease-out; }
  .sfxcue { position: fixed; right: 1.2rem; top: 3.6rem; z-index: 50;
    color: #9b93ab; font-style: italic; font-size: 1.05em;
    background: #14131cb8; border-radius: 8px; padding: 0.25em 0.7em; }
  .sfxcue.hc { background: #000; color: #fff; border: 1px solid #fff; font-style: normal; }
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
  .narration { font-size: clamp(1.35em, 3.2vw, 2.3em); line-height: 1.5;
    color: #e8dfc8; text-wrap: balance; }
  .transcript { color: #8d8599; font-size: 0.95em; display: flex; flex-direction: column; gap: 0.3rem; }
  .transcript p { margin: 0; }
  .transcript .pip { color: #b3a87f; }
  .floor { color: #cdbf9a; letter-spacing: 0.03em; }
  footer { display: flex; gap: 1.2rem; align-items: center; flex-wrap: wrap;
    border-top: 1px solid #2b2738; padding-top: 0.8rem; }
  .mix { display: flex; gap: 0.4rem; align-items: center; color: #9b93ab; font-size: 0.9em; }
  .roster { margin-left: auto; color: #6f687f; font-size: 0.85em; }
</style>
