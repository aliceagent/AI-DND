<script lang="ts">
  import { goto } from "$app/navigation";
  import { connect, joined, lastError, toast, type Role } from "$lib/client";

  // the four Phase-1 archetypes the orchestrator seeds (engine/src/srd.ts)
  const CHARACTERS = [
    { id: "pc.fighter", name: "Kael (Fighter)" },
    { id: "pc.rogue", name: "Vex (Rogue)" },
    { id: "pc.cleric", name: "Mara (Cleric)" },
    { id: "pc.wizard", name: "Oren (Wizard)" },
  ];

  let pickCharacter = $state(false);
  let characterId = $state(CHARACTERS[0].id);
  let last: { id: string; name: string } | null = $state(null);

  try { last = JSON.parse(localStorage.getItem("hermys.lastCharacter") ?? "null"); } catch {}

  $effect(() => {
    if ($joined) goto($joined.role === "creator" ? "/create" : `/${$joined.role}`);
  });
  $effect(() => { // a failed rebind clears the stale memory
    if ($lastError?.includes("unknown character") && last) {
      localStorage.removeItem("hermys.lastCharacter");
      last = null;
      toast("That character isn't at this table — start fresh.");
    }
  });

  const join = (role: Role, charId?: string) =>
    connect(role === "box" ? { role, characterId: charId ?? characterId } : { role });
</script>

<h1>Hermys</h1>
<p class="sub">the table is waiting</p>

{#if last}
  <button class="card hero" onclick={() => join("box", last!.id)}>
    <b>Welcome back, {last.name}</b>
    <span>rejoin as your character — any device, same soul</span>
  </button>
{/if}

<button class="card" onclick={() => join("creator")}>
  <b>✦ Begin a new legend</b>
  <span>create a character — speak your story, get your face</span>
</button>

<button class="card" onclick={() => (pickCharacter = !pickCharacter)}>
  <b>⚔ Play an existing character</b>
  <span>rebind this phone to a character at the table</span>
</button>
{#if pickCharacter}
  <div class="pickrow">
    <select bind:value={characterId}>
      {#each CHARACTERS as c}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button class="go" onclick={() => join("box")}>Join</button>
  </div>
{/if}

<button class="card" onclick={() => join("screen")}>
  <b>▣ The shared screen</b>
  <span>the room's window — scenes, captions, the fight's shape</span>
</button>

<button class="card" onclick={() => join("host")}>
  <b>♔ Host the table</b>
  <span>the gm seat — everything visible, beats, approvals, rewind</span>
</button>

<p class="hint">Phones need the mkcert CA installed once for mic access — see apps/orchestrator/scripts/setup-https.sh</p>

<style>
  .sub { color: #9b93ab; margin-top: -0.6rem; }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem;
    width: 100%; text-align: left; background: #1d1b27; border: 1px solid #353044;
    border-radius: 14px; padding: 1rem 1.2rem; margin-bottom: 0.7rem; }
  .card b { font-size: 1.06em; color: #e8dfc8; }
  .card span { color: #9b93ab; font-size: 0.88em; }
  .card.hero { border-color: #cdbf9a; background: linear-gradient(135deg, #2a2440, #1d1b27);
    box-shadow: 0 0 22px #cdbf9a22; }
  .pickrow { display: flex; gap: 0.6rem; margin: -0.2rem 0 0.7rem; }
  .pickrow select { flex: 1; }
  .go { background: #4a3f6b; border-color: #6b5e93; font-weight: 600; }
  .hint { color: #6f687f; font-size: 0.85em; }
</style>
