<script lang="ts">
  // A link that is only an icon: the back arrow on return links, the pen on edit links. The words
  // stay in labels.ts and become its accessible name.
  let { href, label, icon, testid }: { href: string; label: string; icon: 'back' | 'edit'; testid?: string } = $props();
</script>

<a {href} class="icon {icon}" aria-label={label} title={label} data-testid={testid}>
  {#if icon === 'back'}
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
  {:else}
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
  {/if}
</a>

<style>
  .icon { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: #ffce5c; text-decoration: none; }
  .icon:hover { background: #2a2a2a; }
  .back { margin-left: -10px; }
  .edit { border: 1px solid #555; }
  svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
</style>
