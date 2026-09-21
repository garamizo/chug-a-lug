<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  let { children } = $props();
  $effect(() => { if (!$auth.user) goto('/login'); });
  // One owner for the live day: every screen reads this instance, so there is a single poller.
  $effect(() => { if ($auth.user) return liveDay.start(); });
  const here = $derived(liveDay.here);
  // /live already shows the full ticket; the compact banner is for every *other* screen.
  const showBanner = $derived(!!here?.stop && page.url.pathname !== '/live');
</script>

{#if $auth.user}
  {#if showBanner}
    <a class="banner" href="/live" data-testid="banner">
      <DepartureBoard compact
        station={here?.stop?.station_name || here?.stop?.station_id || ''}
        stopName={here?.stop?.name ?? ''}
        nextStation={here?.onwardStop?.station_name || here?.onwardStop?.station_id || ''}
        trip={liveDay.trip} walkMin={here?.stop?.walk_min ?? 0} now={liveDay.now}
        mode={liveDay.mode} rtFetchedAt={liveDay.rtFetchedAt} />
    </a>
  {/if}
  {@render children()}
{/if}

<style>
  .banner { display: block; position: sticky; top: 64px; z-index: 9; text-decoration: none; color: inherit; }
</style>
