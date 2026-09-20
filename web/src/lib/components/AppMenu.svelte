<script lang="ts">
  // The header menu. Items that belong to later milestones are rendered disabled rather than hidden,
  // so the shape of the finished app is visible and M3 only has to enable them.
  import { goto } from '$app/navigation';
  import { copy, labels } from '$lib/labels';
  import { logout } from '$lib/pb';

  let { open, unread, onclose }: { open: boolean; unread: number; onclose: () => void } = $props();

  const go = (href: string) => { onclose(); void goto(href); };
</script>

{#if open}
  <button type="button" class="scrim" aria-label={copy.close} onclick={onclose}></button>
  <nav class="panel">
    <button type="button" class="item" onclick={() => go('/notifications')} data-testid="menu-notifications">
      <span class="label">{copy.notifications}</span>
      {#if unread}<span class="badge">{unread}</span>{/if}
    </button>
    <button type="button" class="item" disabled>
      <span class="label">{copy.drinkScoreboard}</span><span class="soon">{copy.comingInM3}</span>
    </button>
    <button type="button" class="item" onclick={() => go('/route')}>
      <span class="label">{copy.theRoute}</span>
    </button>
    <button type="button" class="item" disabled>
      <span class="label">{labels.userRoster}</span><span class="soon">{copy.comingInM3}</span>
    </button>
    <button type="button" class="item" onclick={() => { onclose(); logout(); }} data-testid="logout">
      <span class="label">{copy.logout}</span>
    </button>
  </nav>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 20; border: 0; border-radius: 0; margin: 0; padding: 0;
    background: rgba(0,0,0,.55); width: 100%; min-height: 0; }
  .panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 21; width: min(310px, 86vw);
    background: #1a1a1a; border-left: 1px solid #2a2a2a; display: flex; flex-direction: column; padding-top: 57px; }
  .item { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 56px; padding: 14px 20px;
    margin: 0; border: 0; border-bottom: 1px solid #2a2a2a; border-radius: 0; background: transparent;
    color: #eee; font-size: 16.5px; font-weight: 600; text-align: left; }
  .item:disabled { color: #6f6f6f; opacity: 1; cursor: default; }
  .label { flex-grow: 1; }
  .badge { font-size: 13px; font-weight: 700; color: #ffb400; }
  .soon { font-size: 13px; font-weight: 700; color: #6f6f6f; }
</style>
