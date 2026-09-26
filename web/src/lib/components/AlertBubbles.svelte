<script lang="ts">
  // Service alerts above the board: at most two, the rest rolled up. They stay visible in every
  // board state — hiding a delay notice while someone runs for a train is the wrong trade — until
  // this person closes one with its X, which this phone remembers.
  import { copy } from '$lib/labels';
  import { dismissAlert, readDismissed } from '$lib/live/seen';
  import type { Alert } from '$lib/types';
  import IconButton from './IconButton.svelte';

  let { alerts, onopen }: { alerts: Alert[]; onopen: () => void } = $props();
  let dismissed = $state(readDismissed());
  const open = $derived(alerts.filter((a) => !dismissed.has(a.id)));
  const shown = $derived(open.slice(0, 2));
  const extra = $derived(Math.max(0, open.length - 2));
  function close(id: string) {
    dismissAlert(id);
    dismissed = new Set([...dismissed, id]);
  }
</script>

{#if open.length}
  <div class="bubbles">
    {#each shown as alert (alert.id)}
      <div class="bubble">
        <button type="button" class="open" onclick={onopen}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"></path>
          </svg>
          <span>{alert.header}</span>
        </button>
        <IconButton icon="close" size={32} label="{copy.closeAlert}: {alert.header}" onclick={() => close(alert.id)} testid="close-alert" />
      </div>
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
  .bubble { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 44px; padding: 0 5px 0 0; border-radius: 999px;
    margin: 0; font-size: 13.5px; font-weight: 400; border: 1px solid rgba(255,180,0,.42); background: rgba(255,180,0,.12); color: #ffd98a; }
  .open { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 9px; text-align: left; margin: 0; padding: 10px 4px 10px 13px;
    min-height: 0; border: 0; border-radius: 999px 0 0 999px; background: transparent; color: inherit; font: inherit; }
  .open svg { flex: none; margin-top: 1px; }
  .bubble :global(.icon) { border: 0; color: #ffd98a; }
  .more { padding: 10px 13px; text-align: left; border-color: #3a3a3a; background: transparent; color: #9a9a9a; }
</style>
