<script lang="ts">
  // One waiting request at a time over any screen (spec §5).
  import { boardingQueue } from '$lib/live/boardingQueue.svelte';
  import { copy } from '$lib/labels';
  import WaitingList from './WaitingList.svelte';
  const first = $derived(boardingQueue.requests.slice(0, 1));
</script>
{#if first.length}
  <div class="popup" role="dialog" aria-label={copy.waitingToBoard} data-testid="boarding-popup">
    <p class="title">{copy.waitingToBoard}</p>
    <WaitingList items={first} showLater />
  </div>
{/if}
<style>
  .popup { position: fixed; left: 12px; right: 12px; bottom: 84px; z-index: 30; max-width: 520px; margin: 0 auto;
    background: #1f1f1f; border: 1px solid #ffb400; border-radius: 12px; padding: 12px 16px; box-shadow: 0 8px 30px rgba(0,0,0,.6); }
  .title { margin: 0; font-weight: 700; color: #ffb400; }
</style>
