<script lang="ts">
  // The one way to close a bottom sheet: a round X on the sheet's top edge, at the right. Half of it
  // sits above the sheet, so its parent must be positioned and must not clip (no overflow scroll).
  import IconButton from './IconButton.svelte';
  let { label, onclick, testid }: { label: string; onclick: () => void; testid: string } = $props();
</script>

<div class="x"><IconButton icon="close" size={40} {label} {onclick} {testid} /></div>

<style>
  .x { position: absolute; top: -20px; right: 12px; z-index: 2; }
  .x :global(button) { background: #181818; border-color: #3a3a3a; box-shadow: 0 2px 8px #0008; }
  .x :global(button:hover:not(:disabled)) { background: #2a2a2a; }
</style>
