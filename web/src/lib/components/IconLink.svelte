<script lang="ts">
  // A link that is only an icon: the back arrow on return links, the pen on edit links. The words
  // stay in labels.ts and become its accessible name.
  import { ICONS, type IconName } from '$lib/icons';
  let { href, label, icon, testid }: { href: string; label: string; icon: IconName; testid?: string } = $props();
</script>

<a {href} class="icon {icon}" aria-label={label} title={label} data-testid={testid}>
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    {#each ICONS[icon] as d}<path {d} />{/each}
  </svg>
</a>

<style>
  .icon { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: #ffce5c; text-decoration: none; }
  .icon:hover { background: #2a2a2a; }
  .back { margin-left: -10px; }
  .edit { border: 1px solid #555; }
  svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
</style>
