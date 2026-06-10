<script lang="ts">
  import { connection, toasts, lastError } from "$lib/client";
  let { children } = $props();
</script>

<div class="shell">
  {@render children()}
</div>

<div class="toasts">
  {#each $toasts as t (t.id)}
    <div class="toast">{t.text}</div>
  {/each}
  {#if $lastError}
    <div class="toast error" role="alert">{$lastError}</div>
  {/if}
</div>

{#if $connection === "closed"}
  <div class="connbar">connection lost — reload to rejoin</div>
{/if}

<style>
  :global(html) { background: #14131c; color: #e8e4da; }
  :global(body) { margin: 0; font: 16px/1.45 system-ui, sans-serif; }
  :global(h1, h2, h3) { font-weight: 600; letter-spacing: 0.02em; }
  :global(button) {
    background: #2b2738; color: #e8e4da; border: 1px solid #494159;
    border-radius: 10px; padding: 0.6em 1.1em; font-size: 1em; cursor: pointer;
  }
  :global(button:active) { background: #3a3450; }
  :global(input, select) {
    background: #1d1b27; color: #e8e4da; border: 1px solid #494159;
    border-radius: 8px; padding: 0.55em 0.7em; font-size: 1em;
  }
  .shell { max-width: 720px; margin: 0 auto; padding: 1rem; min-height: 100dvh; box-sizing: border-box; }
  .toasts { position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; gap: 0.5rem; z-index: 50; width: min(92vw, 28rem); }
  .toast { background: #322c45; border: 1px solid #5d5378; border-radius: 10px;
    padding: 0.7em 1em; box-shadow: 0 6px 24px #0008; animation: rise 0.25s ease-out; }
  .toast.error { border-color: #a04545; background: #3d2330; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
  .connbar { position: fixed; top: 0; left: 0; right: 0; background: #7c2d2d;
    text-align: center; padding: 0.3em; font-size: 0.9em; z-index: 60; }
</style>
