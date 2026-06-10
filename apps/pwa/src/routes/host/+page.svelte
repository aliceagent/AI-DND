<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, events, send } from "$lib/client";

  $effect(() => { if (!$joined) goto("/"); });

  function rewindTo(eventId: number) {
    if (confirm(`Rewind the table to event ${eventId}? Later events move to an excluded branch.`))
      send({ type: "rewind", eventId });
  }

  const vis = (v: unknown) => v === "public" ? "pub" : v === "gm" ? "gm" : `→${(v as string[]).join(",")}`;
</script>

<h2>Host — gm timeline</h2>
<p class="sub">the only seat that sees everything; rewind opens a new branch</p>

<table>
  <tbody>
    {#each $events as e (e.id)}
      <tr class:gm={e.visibility === "gm"}>
        <td class="id">{e.id}</td>
        <td class="type">{e.type}</td>
        <td class="vis">{vis(e.visibility)}</td>
        <td class="payload">{JSON.stringify(e.payload).slice(0, 90)}</td>
        <td><button class="mini" onclick={() => rewindTo(e.id)}>⟲</button></td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .sub { color: #9b93ab; margin-top: -0.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82em; }
  td { padding: 0.25em 0.5em; border-bottom: 1px solid #232030; vertical-align: top; }
  .id { color: #6f687f; }
  .type { white-space: nowrap; color: #cdbf9a; }
  .vis { white-space: nowrap; color: #9b93ab; }
  .payload { font-family: ui-monospace, monospace; word-break: break-all; color: #b6aec7; }
  .gm .type { color: #d08770; }
  .mini { padding: 0.1em 0.5em; font-size: 0.9em; }
</style>
