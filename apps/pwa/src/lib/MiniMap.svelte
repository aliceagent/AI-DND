<script lang="ts">
  /** Renders the SERVER-fogged graph: known nodes carry names; frontier
   *  stubs arrive nameless by design — the wire keeps the secrets, this
   *  component just draws what it was allowed to hear. */
  import { sigil } from "$lib/palettes";
  import { a11y, motionReduced } from "$lib/a11y";

  let { graph = null, currentId = null, glow = "#cdbf9a" }:
    { graph?: { nodes: any[]; edges: any[] } | null; currentId?: string | null; glow?: string } = $props();

  const byId = $derived(new Map((graph?.nodes ?? []).map(n => [n.id, n])));
  const here = $derived(currentId ? byId.get(currentId) : null);
  const rm = $derived(motionReduced($a11y));
</script>

{#if graph}
<svg viewBox="0 0 200 140" role="img"
     aria-label={here?.name ? `map — you are at ${here.name}` : "map"}>
  {#each graph.edges as e}
    {@const a = byId.get(e.from)}
    {@const b = byId.get(e.to)}
    {#if a && b}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={e.known ? "#5d5378" : "#3a3450"} stroke-width="1.5"
        stroke-dasharray={e.known ? "" : "3 4"} />
    {/if}
  {/each}
  {#each graph.nodes as n (n.id)}
    {#if n.known}
      {#if currentId === n.id}
        <circle cx={n.x} cy={n.y} r="11" fill="none" stroke={glow} stroke-width="1.5"
          opacity="0.8">{#if !rm}<animate attributeName="r" values="9;13;9" dur="2.4s" repeatCount="indefinite" />{/if}</circle>
      {/if}
      <circle cx={n.x} cy={n.y} r="6" fill={currentId === n.id ? glow : "#4a3f6b"}
        stroke="#14131c" stroke-width="1.5" />
      <text x={n.x} y={n.y - 11} text-anchor="middle" class="lbl"
        fill={currentId === n.id ? glow : "#b6aec7"}>{sigil(n.id)} {n.name}</text>
    {:else}
      <circle cx={n.x} cy={n.y} r="5" fill="none" stroke="#3a3450" stroke-width="1.2"
        stroke-dasharray="2 3" />
      <text x={n.x} y={n.y + 3.5} text-anchor="middle" class="unknown" fill="#6f687f">?</text>
    {/if}
  {/each}
</svg>
{/if}

<style>
  svg { width: 100%; height: 100%; }
  .lbl { font-size: 7.5px; font-family: system-ui, sans-serif; letter-spacing: 0.02em; }
  .unknown { font-size: 7px; font-family: system-ui, sans-serif; }
</style>
