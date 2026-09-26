<script lang="ts">
  import type { Snippet } from 'svelte';
  let { heads, children, testid }: { heads: [string, string]; children: Snippet; testid?: string } = $props();
</script>

<div class="board" role="list" data-testid={testid}>
  <div class="hd" aria-hidden="true"><span>{heads[0]}</span><span>{heads[1]}</span></div>
  {@render children()}
</div>

<style>
  .board { background: var(--board-bg, #0b0b0b); border: 2px solid #333; border-radius: 12px; overflow: hidden; margin: 12px 0; }
  .hd { display: flex; justify-content: space-between; background: #1d1d1d; padding: 6px 12px; font-size: 11px;
    letter-spacing: .14em; text-transform: uppercase; color: var(--gold, #ffb400); font-weight: 800; }
</style>
