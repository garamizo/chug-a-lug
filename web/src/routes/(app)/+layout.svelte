<script lang="ts">
  import { clientClock } from '$lib/sim/clock.svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { pb, auth, refreshSession, logout } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import PinnedBulletin from '$lib/components/PinnedBulletin.svelte';
  import BulletinSheet from '$lib/components/BulletinSheet.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import TabHost from '$lib/components/TabHost.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import SpikeCelebration from '$lib/components/SpikeCelebration.svelte';
  import type { CelebrationScope } from '$lib/live/celebrate';
  import { newRecordId } from '$lib/live/staged';
  let { children } = $props();
  let error = $state('');
  $effect(() => { if (!$auth.user) goto('/login'); });
  // Session-scoped effects key on the user id, not the record: authStore.save publishes a fresh
  // record on every renewal or rename, and re-running them would restart the poller.
  const userId = $derived($auth.user?.id ?? '');
  // One owner for the live day: every screen reads this instance, so there is a single poller.
  $effect(() => {
    const id = userId;
    if (!id) return;
    let disposed = false;
    let stopDay: (() => void) | undefined;
    if (!clientClock.enabled) return liveDay.start();
    const stopClock = clientClock.start();
    void clientClock.sync().catch(() => {}).then(() => { if (!disposed) stopDay = liveDay.start(); });
    return () => { disposed = true; stopDay?.(); stopClock(); };
  });
  // Spec §5: once per session per app open. A put-off session ends; no signal keeps it. A late
  // answer for a session that has since logged out (or switched user) is ignored.
  let checkedFor = '';
  $effect(() => {
    const id = userId;
    if (!id || id === checkedFor) return;
    checkedFor = id;
    void refreshSession().then((r) => { if (r === 'signed_out' && pb.authStore.record?.id === id) logout(); });
  });
  const here = $derived(liveDay.here);
  const onLive = $derived(page.url.pathname === '/live');
  // The tab bar's own screens: on a practice day they carry it too, so the crew can move between them.
  const onTabScreen = $derived(['/live', '/route', '/crew'].includes(page.url.pathname));
  // Practice interrupts only the screen that is practising; planning and voting stay quiet.
  const quiet = $derived(liveDay.practice && !onLive);
  // Closing Time's reel is a presentation: nothing of the app's own sits over it or hears its taps and keys.
  const presenting = $derived(page.url.pathname === '/live/closing');
  const tabBar = $derived(!presenting && (liveDay.isEventDay || (liveDay.practice && onTabScreen)));
  // Whose celebration, on which route, server day and simulation run: the Tab's proof scope. None
  // until the clock is known, so a run's first sync cannot replay another run's awards.
  const celebrationScope = $derived<CelebrationScope | null>(userId && liveDay.clockKnown && liveDay.itinerary
    ? { itinerary: liveDay.itinerary.id, date: liveDay.today, runId: clientClock.runId ?? null, user: userId } : null);
  // /live already shows the full ticket; the compact banner is for every *other* screen.
  const showBanner = $derived(!!here?.stop && !onLive && !quiet && !presenting);
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
    const key = stopId === undefined ? null : `${stopId}:${here?.onwardStop?.id ?? ''}:${liveDay.boarding?.from ?? ''}:${liveDay.rideHome?.to ?? ''}`;
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

  // The composer belongs to the screen it was opened on: leaving closes it.
  afterNavigate(() => { liveDay.composing = false; });

  async function ack(broadcastId: string) {
    if (!$auth.user) return;
    error = '';
    // liveDay hides it immediately; only a Got it that could not be saved brings it back.
    if (!(await liveDay.ack(broadcastId, $auth.user.id))) error = copy.noSignal;
  }

  async function postBulletin(body: string) {
    error = '';
    liveDay.composing = false;
    if (!liveDay.itinerary || !$auth.user || !body) return;
    try {
      await clientClock.ready();
      await pb.collection('broadcasts').create({ id: newRecordId(), itinerary: liveDay.itinerary.id, kind: 'message', body, created_by: $auth.user.id });
      await liveDay.loadBulletins();
    } catch { error = copy.noSignal; }
  }
</script>

{#if $auth.user}
  {#if showBanner}
    {@const b = liveDay.boarding}
    {@const h = liveDay.rideHome}
    <a class="banner" href="/live" data-testid="banner">
      <DepartureBoard compact
        station={b ? b.fromName : here?.stop?.station_name || here?.stop?.station_id || ''}
        stopName={here?.stop?.name ?? ''}
        nextStation={b ? b.toName : h ? h.toName : here?.onwardStop?.station_name || here?.onwardStop?.station_id || ''}
        trip={liveDay.trip} walkMin={b ? b.walkMin : here?.stop?.walk_min ?? 0} now={liveDay.now}
        mode={liveDay.mode} rtFetchedAt={liveDay.rtFetchedAt}
        ridingHome={h?.riding ? { arriveAt: h.arriveAt, toName: h.toName } : undefined} />
    </a>
  {/if}
  {#if liveDay.pinnedBulletin && !quiet && !presenting}
    <PinnedBulletin bulletin={liveDay.pinnedBulletin} onack={() => void ack(liveDay.pinnedBulletin!.id)} />
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {@render children()}
  <!-- The Tab opens from the tab bar, so a practice day's Live, Route and Crew Board need it too; the planner stays practice-free. -->
  {#if tabBar}<TabBar />{/if}
  <!-- Mounted with the session, not the bar: a drink still sending finishes wherever its person went. -->
  <TabHost shown={tabBar} />
  <Lightbox />
  <!-- Paused, not dropped, under the reel: its queue waits as it does for practice's quiet, and a card cut short comes back. -->
  <SpikeCelebration scope={celebrationScope} quiet={quiet || presenting} />
  {#if liveDay.composing && !presenting}
    <BulletinSheet text="" onsend={(body) => void postBulletin(body)} onskip={() => (liveDay.composing = false)} ondismiss={() => (liveDay.composing = false)} />
  {/if}
{/if}

<style>
  .banner { display: block; position: sticky; top: 64px; z-index: 9; text-decoration: none; color: inherit; }
</style>
