<script lang="ts">
  // The Tab as a sheet over Live: opened from the tab bar, closed by its X, a tap outside or Escape.
  // It stays open between taps so a round can be logged one drink after another.
  import type { Snippet } from 'svelte';
  import { copy } from '$lib/labels';
  import IconButton from './IconButton.svelte';
  let { onclose, children }: { onclose: () => void; children: Snippet } = $props();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />
<button type="button" class="scrim" aria-label={copy.closeTab} tabindex="-1" onclick={onclose} data-testid="tab-scrim"></button>
<div class="sheet" role="dialog" aria-modal="true" aria-label={copy.tabTitle} data-testid="tab-sheet">
  <div class="close"><IconButton icon="close" size={36} label={copy.closeTab} onclick={onclose} testid="tab-close" /></div>
  {@render children()}
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 30; border: 0; border-radius: 0; margin: 0; padding: 0; width: auto; min-height: 0;
    background: rgba(0, 0, 0, .55); }
  .sheet { position: fixed; inset: auto 0 0; z-index: 31; background: #1b1b1b; border-top: 1px solid #444;
    border-radius: 16px 16px 0 0; padding: 14px 14px calc(16px + env(safe-area-inset-bottom)); max-width: 760px; margin: 0 auto; }
  .close { position: absolute; top: 8px; right: 10px; }
</style>
