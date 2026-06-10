<script lang="ts">
  /** Prep Bench skeleton (mac-week §5): review ingestion drafts — beat list,
   *  fact/reveal-tag editor, source-page reference, approve toggle. Loads
   *  the drafts JSON the ingest CLI wrote (file input for now; the Spark
   *  week wires it to the orchestrator). Nothing unapproved enters a live
   *  session — approval happens HERE, by a human, only. */

  let beats: any[] = $state([]);
  let entities: any[] = $state([]);
  let loadedFrom = $state("");

  const SCOPES = ["public", "gated", "gm_only"];

  async function loadFile(e: Event, kind: "beats" | "entities") {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (kind === "beats") beats = data; else entities = data;
    loadedFrom = file.name;
  }

  function cardsFor(beat: any): any[] {
    return (beat.entities ?? []).map((id: string) => entities.find(c => c.id === id)).filter(Boolean);
  }

  function exportApproved() {
    const out = { beats, entities };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reviewed.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const approvedCount = $derived(beats.filter(b => b.approved).length);
</script>

<h2>Prep Bench</h2>
<p class="sub">human approval is the gate — unapproved beats never go live</p>

<div class="loadrow">
  <label class="load">beats.json <input type="file" accept=".json" onchange={e => loadFile(e, "beats")} /></label>
  <label class="load">entities.json <input type="file" accept=".json" onchange={e => loadFile(e, "entities")} /></label>
  {#if beats.length}
    <span class="count">{approvedCount}/{beats.length} approved</span>
    <button onclick={exportApproved}>export reviewed</button>
  {/if}
</div>

{#each beats as beat (beat.id)}
  <article class:approved={beat.approved}>
    <header>
      <div>
        <strong>{beat.id}</strong>
        <span class="tag">{beat.type}</span>
        {#if beat.source_ref}<span class="src">{beat.source_ref}</span>{/if}
      </div>
      <label class="approve">
        <input type="checkbox" bind:checked={beat.approved} /> approved
      </label>
    </header>

    {#if beat.secrets?.length}
      <p class="secrets">secrets at entry: {beat.secrets.join(", ")}</p>
    {/if}
    {#if beat.rules_notes}
      <p class="rules">{beat.rules_notes}</p>
    {/if}

    {#each cardsFor(beat) as card (card.id)}
      <section class="card">
        <h4>{card.names?.canonical ?? card.id} <span class="tag">{card.kind}</span>
          {#if card.source_ref}<span class="src">{card.source_ref}</span>{/if}</h4>
        {#each Object.entries(card.states ?? {}) as [stateId, st]}
          {#each (st as any).facts ?? [] as fact (fact.id)}
            <div class="fact">
              <select bind:value={fact.scope}>
                {#each SCOPES as s}<option value={s}>{s}</option>{/each}
              </select>
              <span class="ftext" class:gm={fact.scope === "gm_only"}>{fact.text}</span>
            </div>
          {/each}
        {/each}
      </section>
    {/each}
  </article>
{/each}

{#if !beats.length}
  <p class="hint">run <code>npm run ingest -- segments.json</code> in ingest/, then load
  <code>packs/hotdq/drafts/beats.json</code> and <code>entities.json</code> here.</p>
{/if}

<style>
  .sub { color: #9b93ab; margin-top: -0.5rem; }
  .loadrow { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
  .load { color: #9b93ab; font-size: 0.85em; display: flex; flex-direction: column; gap: 0.2rem; }
  .count { color: #cdbf9a; }
  article { border: 1px solid #353044; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; background: #1d1b27; }
  article.approved { border-color: #4a7c5f; }
  article > header { display: flex; justify-content: space-between; align-items: center; }
  .tag { background: #2b2738; border-radius: 6px; padding: 0.1em 0.5em; font-size: 0.8em; margin-left: 0.5em; color: #b6aec7; }
  .src { color: #6f687f; font-size: 0.8em; margin-left: 0.5em; }
  .approve { color: #9b93ab; display: flex; gap: 0.4em; align-items: center; }
  .secrets { color: #d08770; font-size: 0.85em; }
  .rules { color: #9b93ab; font-size: 0.85em; font-style: italic; }
  .card { border-top: 1px solid #2b2738; margin-top: 0.8rem; padding-top: 0.6rem; }
  .card h4 { margin: 0 0 0.5rem; }
  .fact { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.35rem; }
  .fact select { font-size: 0.8em; padding: 0.25em 0.4em; }
  .ftext { font-size: 0.92em; }
  .ftext.gm { color: #d08770; }
  .hint { color: #6f687f; }
  code { background: #2b2738; padding: 0.1em 0.4em; border-radius: 5px; }
</style>
