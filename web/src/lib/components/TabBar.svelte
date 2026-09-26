<script lang="ts">
  // Live's navigation: the three screens people actually switch between, plus the Tab. The menu is
  // in the header already; the Tab opens its sheet over Live, going to Live first if need be.
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { copy, labels } from '$lib/labels';
  import { auth } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import { drinkCount } from '$lib/live/crew';
  import { ui } from '$lib/ui.svelte';
  const tabs = [
    { href: '/live', id: 'live', icon: '🎟️', label: labels.livePhase },
    { href: '/route', id: 'route', icon: '🚂', label: labels.lockedItinerary },
    { href: '/crew', id: 'crew', icon: '🏆', label: labels.userRoster }
  ];
  const total = $derived($auth.user ? drinkCount(liveDay.feed.drinks, $auth.user.id, liveDay.today) : 0);
  function openTab() {
    ui.tabOpen = true;
    if (page.url.pathname !== '/live') void goto('/live');
  }
</script>

<nav class="tabbar" aria-label={copy.mainNav} data-testid="tab-bar">
  {#each tabs as tab (tab.id)}
    <a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined} data-testid="tab-{tab.id}">
      <span aria-hidden="true">{tab.icon}</span>{tab.label}
    </a>
  {/each}
  <button type="button" onclick={openTab} aria-expanded={ui.tabOpen} data-testid="tab-drinks">
    <span aria-hidden="true">🍻</span>{copy.tabTitle}{#if total}<b class="count" data-testid="tab-bar-total">{total}</b>{/if}
  </button>
</nav>

<style>
  .tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 15; display: grid; grid-template-columns: repeat(4, 1fr);
    background: rgba(17, 17, 17, .96); backdrop-filter: blur(8px); border-top: 1px solid #2a2a2a;
    padding-bottom: env(safe-area-inset-bottom); }
  a, button { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 60px;
    margin: 0; padding: 6px 2px; border: 0; border-radius: 0; background: transparent; color: #aaa; font-size: 11.5px;
    font-weight: 650; text-decoration: none; width: auto; }
  span { font-size: 22px; line-height: 1; }
  a[aria-current='page'], button[aria-expanded='true'] { color: #ffb400; }
  .count { position: absolute; top: 5px; left: calc(50% + 8px); min-width: 18px; padding: 1px 5px; border-radius: 999px;
    background: #ffb400; color: #111; font-size: 11px; font-weight: 800; line-height: 16px; }
  :global(body:has(.tabbar)) { padding-bottom: calc(64px + env(safe-area-inset-bottom)); }
</style>
