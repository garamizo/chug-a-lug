<script lang="ts">
  // Service alerts above the board: at most two, the rest rolled up. They stay visible in every
  // board state — hiding a delay notice while someone runs for a train is the wrong trade.
  import { copy } from '$lib/labels';
  import type { Alert } from '$lib/types';

  let { alerts, onopen }: { alerts: Alert[]; onopen: () => void } = $props();
  const shown = $derived(alerts.slice(0, 2));
  const extra = $derived(Math.max(0, alerts.length - 2));
</script>

{#if alerts.length}
  <div class="bubbles">
    {#each shown as alert (alert.id)}
      <button type="button" class="bubble" onclick={onopen}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"></path>
        </svg>
        <span>{alert.header}</span>
      </button>
    {/each}
    {#if extra}
      <button type="button" class="bubble more" onclick={onopen}>
        <span>{extra} {extra === 1 ? copy.oneMoreAlert : copy.moreAlerts}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .bubbles { padding: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
  .bubble { display: flex; align-items: flex-start; gap: 9px; text-align: left; width: 100%;
    min-height: 44px; padding: 10px 13px; border-radius: 999px; margin: 0; font-size: 13.5px; font-weight: 400;
    border: 1px solid rgba(255,180,0,.42); background: rgba(255,180,0,.12); color: #ffd98a; }
  .bubble svg { flex: none; margin-top: 1px; }
  .more { border-color: #3a3a3a; background: transparent; color: #9a9a9a; }
</style>
