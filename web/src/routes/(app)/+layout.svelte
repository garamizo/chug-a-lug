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
  // Re-ask for trains the instant the leg we are counting down changes — a Conductor's correction
  // or a saved route change must not wait out the 30 s poll, since the whole app now reads this
  // same board. Spelled out as two ids (not `here` itself) so this does not re-fire on every tick
  // of `now`. The very first time `here` resolves is skipped: `liveDay.start()`'s own initial chain
  // already fetches trains for that first position, and firing here too would race it with a
  // second, redundant request for the same answer.
  let coveredByStart = true;
  $effect(() => {
    const stopId = here?.stop?.id;
    const onwardId = here?.onwardStop?.id;
    if (coveredByStart) {
      if (stopId === undefined) return;
      coveredByStart = false;
      return;
    }
    void onwardId;
    void liveDay.loadTrains();
  });
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
