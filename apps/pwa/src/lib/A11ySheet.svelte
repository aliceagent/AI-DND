<script lang="ts">
  import { a11y } from "$lib/a11y";
  let open = $state(false);
</script>

<button class="gear" onclick={() => (open = !open)} aria-label="accessibility settings">⚙</button>

{#if open}
  <div class="sheet" role="dialog" aria-label="accessibility settings">
    <h3>Accessibility</h3>
    <label><input type="checkbox" bind:checked={$a11y.captions} /> captions</label>
    <label>caption size
      <select bind:value={$a11y.captionSize}>
        <option value="normal">normal</option>
        <option value="large">large</option>
      </select>
    </label>
    <label><input type="checkbox" bind:checked={$a11y.highContrast} /> high contrast</label>
    <label>motion
      <select bind:value={$a11y.reduceMotion}>
        <option value="auto">follow device</option>
        <option value="on">reduced</option>
        <option value="off">full</option>
      </select>
    </label>
    <label><input type="checkbox" bind:checked={$a11y.haptics} /> vibration cues</label>
    <button class="done" onclick={() => (open = false)}>done</button>
  </div>
{/if}

<style>
  .gear { position: fixed; bottom: 1rem; right: 1rem; z-index: 60;
    width: 2.6rem; height: 2.6rem; border-radius: 50%; font-size: 1.1em;
    background: #14131ccc; backdrop-filter: blur(6px); }
  .sheet { position: fixed; bottom: 4.2rem; right: 1rem; z-index: 60;
    background: #1d1b27; border: 1px solid #5d5378; border-radius: 14px;
    padding: 1rem 1.2rem; display: flex; flex-direction: column; gap: 0.7rem;
    box-shadow: 0 10px 40px #000a; min-width: 15rem; }
  h3 { margin: 0 0 0.2rem; font-size: 1em; color: #cdbf9a; }
  label { display: flex; justify-content: space-between; gap: 0.8rem;
    align-items: center; color: #b6aec7; font-size: 0.92em; }
  .done { margin-top: 0.3rem; }
</style>
