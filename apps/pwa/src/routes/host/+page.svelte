<script lang="ts">
  import { goto } from "$app/navigation";
  import { joined, events, send, approvals, tableState } from "$lib/client";

  $effect(() => { if (!$joined) goto("/"); });

  function rewindTo(eventId: number) {
    if (confirm(`Rewind the table to event ${eventId}? Later events move to an excluded branch.`))
      send({ type: "rewind", eventId });
  }

  const vis = (v: unknown) => v === "public" ? "pub" : v === "gm" ? "gm" : `→${(v as string[]).join(",")}`;
</script>

<h2>Host — gm timeline</h2>
<p class="sub">the only seat that sees everything; rewind opens a new branch</p>

{#if $tableState}
  <div class="meter">
    table pulse: <b class="up">▲ {$tableState.pace.up}</b> · <b class="down">▼ {$tableState.pace.down}</b>
  </div>
{/if}

{#if $approvals.queue.length}
  <div class="queue">
    {#each $approvals.queue as a (a.kind + a.characterId)}
      <div class="appr">
        <span><b>{a.kind}</b> · {a.characterId.replace("pc.", "")}</span>
        <span>
          <button class="mini ok" onclick={() => send({ type: "approve", characterId: a.characterId, kind: a.kind, ok: true })}>approve</button>
          <button class="mini no" onclick={() => send({ type: "approve", characterId: a.characterId, kind: a.kind, ok: false })}>again</button>
        </span>
      </div>
    {/each}
  </div>
{/if}

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
  .meter { color: #9b93ab; margin-bottom: 0.6rem; }
  .meter .up { color: #9fd49f; } .meter .down { color: #d08770; }
  .queue { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.8rem; }
  .appr { display: flex; justify-content: space-between; align-items: center;
    background: #1d1b27; border: 1px solid #5d5378; border-radius: 10px; padding: 0.5rem 0.8rem; }
  .ok { background: #2d4a3a; border-color: #4a7c5f; }
  .no { background: #4d2330; border-color: #7c3a4d; }
</style>
