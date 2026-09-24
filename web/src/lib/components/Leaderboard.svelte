<script lang="ts">
  import { copy } from '$lib/labels';
  import type { Leader } from '$lib/live/leaderboard';
  let { leaders }: { leaders: Leader[] } = $props();
</script>

{#if leaders.length}
  <a class="podium" href="/crew" data-testid="leaderboard">
    <span aria-hidden="true">🏆</span>
    <span class="sr">{copy.leaderboard}:</span>
    <span class="names">{#each leaders as l, i (l.userId)}{#if i} · {/if}<span class:me={l.me}>{l.me ? copy.you : l.name} {l.total}</span>{/each}</span>
    <span aria-hidden="true">→</span>
  </a>
{/if}

<style>
  .podium { display: flex; gap: 10px; align-items: center; margin: 4px 20px 0; padding: 10px 14px; border-radius: 12px;
    background: #1b1b1b; border: 1px solid #333; color: #ddd; text-decoration: none; font-weight: 650; font-size: 14px; }
  .names { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .me { color: #ffce5c; }
  .sr { position: absolute; left: -9999px; }
</style>
