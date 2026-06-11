<script lang="ts">
  import { DEMO_MAP } from "$lib/demo-map";
  import { sigil } from "$lib/palettes";
  import { a11y, motionReduced } from "$lib/a11y";

  let { visited = [], currentId = null, glow = "#cdbf9a" }:
    { visited?: string[]; currentId?: string | null; glow?: string } = $props();

  const seen = $derived(new Set(visited));
  // fog: visited nodes in full; unvisited neighbors of visited as "?" stubs
  const frontier = $derived(new Set(DEMO_MAP.edges
    .filter(e => seen.has(e.from) !== seen.has(e.to))
    .map(e => (seen.has(e.from) ? e.to : e.from))));
  const node = (id: string) => DEMO_MAP.nodes.find(n => n.id === id)!;
  const here = $derived(currentId ? node(currentId) : null);
  const rm = $derived(motionReduced($a11y));
</script>

<svg viewBox="0 0 200 140" role="img"
     aria-label={here ? `map — you are at ${here.name}` : "map"}>
  {#each DEMO_MAP.edges as e}
    {#if seen.has(e.from) || seen.has(e.to)}
      {@const a = node(e.from)}
      {@const b = node(e.to)}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={seen.has(e.from) && seen.has(e.to) ? "#5d5378" : "#3a3450"}
        stroke-width="1.5"
        stroke-dasharray={seen.has(e.from) && seen.has(e.to) ? "" : "3 4"} />
    {/if}
  {/each}
  {#each DEMO_MAP.nodes as n (n.id)}
    {#if seen.has(n.id)}
      {#if currentId === n.id}
        <circle cx={n.x} cy={n.y} r="11" fill="none" stroke={glow} stroke-width="1.5"
          opacity="0.8">{#if !rm}<animate attributeName="r" values="9;13;9" dur="2.4s" repeatCount="indefinite" />{/if}</circle>
      {/if}
      <circle cx={n.x} cy={n.y} r="6" fill={currentId === n.id ? glow : "#4a3f6b"}
        stroke="#14131c" stroke-width="1.5" />
      <text x={n.x} y={n.y - 11} text-anchor="middle" class="lbl"
        fill={currentId === n.id ? glow : "#b6aec7"}>{sigil(n.id)} {n.name}</text>
    {:else if frontier.has(n.id)}
      <circle cx={n.x} cy={n.y} r="5" fill="none" stroke="#3a3450" stroke-width="1.2"
        stroke-dasharray="2 3" />
      <text x={n.x} y={n.y + 3.5} text-anchor="middle" class="unknown" fill="#6f687f">?</text>
    {/if}
  {/each}
</svg>

<style>
  svg { width: 100%; height: 100%; }
  .lbl { font-size: 7.5px; font-family: system-ui, sans-serif; letter-spacing: 0.02em; }
  .unknown { font-size: 7px; font-family: system-ui, sans-serif; }
</style>
