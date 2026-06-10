<script lang="ts">
  import { goto } from "$app/navigation";
  import { connect, joined, type Role } from "$lib/client";

  // the four Phase-1 archetypes the orchestrator seeds (engine/src/srd.ts)
  const CHARACTERS = [
    { id: "pc.fighter", name: "Kael (Fighter)" },
    { id: "pc.rogue", name: "Vex (Rogue)" },
    { id: "pc.cleric", name: "Mara (Cleric)" },
    { id: "pc.wizard", name: "Oren (Wizard)" },
  ];

  let role: Role = $state("box");
  let characterId = $state(CHARACTERS[0].id);

  $effect(() => {
    if ($joined) goto(`/${$joined.role}`);
  });

  function join() {
    connect(role === "box" ? { role, characterId } : { role });
  }
</script>

<h1>Hermys</h1>
<p class="sub">join the table</p>

<div class="card">
  <label>
    Seat
    <select bind:value={role}>
      <option value="box">Player (Box)</option>
      <option value="screen">Shared screen</option>
      <option value="host">Host</option>
    </select>
  </label>

  {#if role === "box"}
    <label>
      Character
      <select bind:value={characterId}>
        {#each CHARACTERS as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>
  {/if}

  <button class="go" onclick={join}>Join</button>
</div>

<p class="hint">Phones need the mkcert CA installed once for mic access — see apps/orchestrator/scripts/setup-https.sh</p>

<style>
  .sub { color: #9b93ab; margin-top: -0.6rem; }
  .card { display: flex; flex-direction: column; gap: 1rem; background: #1d1b27;
    border: 1px solid #353044; border-radius: 14px; padding: 1.2rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; color: #b6aec7; }
  .go { background: #4a3f6b; border-color: #6b5e93; font-weight: 600; }
  .hint { color: #6f687f; font-size: 0.85em; }
</style>
