<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { pb, auth } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import PinnedBulletin from '$lib/components/PinnedBulletin.svelte';
  import BulletinSheet from '$lib/components/BulletinSheet.svelte';
  import { newRecordId } from '$lib/live/staged';
  let { children } = $props();
  let error = $state('');
  $effect(() => { if (!$auth.user) goto('/login'); });
  // One owner for the live day: every screen reads this instance, so there is a single poller.
  $effect(() => { if ($auth.user) return liveDay.start(); });
  const here = $derived(liveDay.here);
  // /live already shows the full ticket; the compact banner is for every *other* screen.
  const showBanner = $derived(!!here?.stop && page.url.pathname !== '/live');
  // Re-ask for trains the instant the leg we are counting down changes — a Conductor's correction
  // or a saved route change must not wait out the 30 s poll, since the whole app now reads this
  // same board. `here` is a fresh object every time anything about the route reloads (a save
  // rewrites every leg, not just the one that changed), so the effect compares the two ids it
  // actually cares about rather than reacting to `here` itself — otherwise a save that leaves the
  // crawl's position untouched would still re-fire this on every one of those reloads. The very
  // first time `here` resolves is skipped the same way: `liveDay.start()`'s own initial chain
  // already fetches trains for that first position, and firing here too would race it with a
  // second, redundant request for the same answer.
  let lastKey: string | null = null;
  let coveredByStart = true;
  $effect(() => {
    const stopId = here?.stop?.id;
    const key = stopId === undefined ? null : `${stopId}:${here?.onwardStop?.id ?? ''}`;
    if (coveredByStart) {
      if (key === null) return;
      coveredByStart = false;
      lastKey = key;
      return;
    }
    if (key === lastKey) return;
    lastKey = key;
    void liveDay.loadTrains();
  });

  async function ack(broadcastId: string) {
    if (!$auth.user) return;
    error = '';
    try {
      await pb.collection('broadcast_acks').create({ broadcast: broadcastId, user: $auth.user.id });
    } catch { error = copy.noSignal; }
    await liveDay.loadBulletins();
    // Another tab may already have acknowledged it; a successful refresh settles that case.
    if (liveDay.ackedIds.includes(broadcastId)) error = '';
  }

  async function postBulletin(body: string) {
    error = '';
    liveDay.composing = false;
    if (!liveDay.itinerary || !$auth.user || !body) return;
    try {
      await pb.collection('broadcasts').create({ id: newRecordId(), itinerary: liveDay.itinerary.id, kind: 'message', body, created_by: $auth.user.id });
      await liveDay.loadBulletins();
    } catch { error = copy.noSignal; }
  }
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
  {#if liveDay.pinnedBulletin}
    <PinnedBulletin bulletin={liveDay.pinnedBulletin} onack={() => void ack(liveDay.pinnedBulletin!.id)} />
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {@render children()}
  {#if liveDay.composing}
    <BulletinSheet text="" onsend={(body) => void postBulletin(body)} onskip={() => (liveDay.composing = false)} />
  {/if}
{/if}

<style>
  .banner { display: block; position: sticky; top: 64px; z-index: 9; text-decoration: none; color: inherit; }
</style>
