<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  import { goto } from '$app/navigation';
  import { copy } from '$lib/labels';
  import { pb, auth, subscribe } from '$lib/pb';
  import { fmtTime, localToUtc, parseHm, todayInTz } from '$lib/time';
  import { currentStop } from '$lib/live/current';
  import { pickTrip } from '$lib/live/board';
  import { fetchAlerts, fetchNext, fetchStatus } from '$lib/live/feed';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import type { Alert, Checkin, FeedMode, Itinerary, Leg, NextTrip, Stop } from '$lib/types';

  let itinerary = $state<Itinerary | null>(null);
  let stops = $state<Stop[]>([]);
  let legs = $state<Leg[]>([]);
  let override = $state<{ stopId: string; at: string } | null>(null);
  let trips = $state<NextTrip[]>([]);
  let alerts = $state<Alert[]>([]);
  let mode = $state<FeedMode>('schedule_only');
  let rtFetchedAt = $state<string | null>(null);
  let now = $state(new Date());
  let error = $state('');
  let picking = $state(false);

  const isAdmin = $derived(!!$auth.user?.is_admin);
  // The crawl's start in real time: event_date plus start_time, read in Chicago's timezone.
  const startAt = $derived(itinerary ? localToUtc(itinerary.event_date, parseHm(itinerary.start_time)) : new Date());
  // The board only takes over on the day itself; before then /live points back at the plan.
  const isToday = $derived(!!itinerary && itinerary.event_date === todayInTz(now));
  const here = $derived(itinerary && isToday ? currentStop(stops, legs, now, { startAt, override }) : null);
  const trip = $derived(pickTrip(trips, now));
  const remaining = $derived(stops.filter((s) => s.order > (here?.stop?.order ?? 0)));

  async function loadRoute() {
    try {
      const list = await pb.collection('itineraries').getFullList<Itinerary>({ filter: pb.filter('status = "locked"'), sort: '-locked_at' });
      itinerary = list[0] ?? null;
      if (!itinerary) return;
      const filter = pb.filter('itinerary = {:id}', { id: itinerary.id });
      [stops, legs] = await Promise.all([
        pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created' }),
        pb.collection('legs').getFullList<Leg>({ filter })
      ]);
      await loadOverride();
    } catch {
      error = copy.loadError;
    }
  }

  /** The newest correction made by a Conductor. */
  async function loadOverride() {
    try {
      const rows = await pb.collection('checkins').getList<Checkin>(1, 20, {
        filter: pb.filter('kind = "at_stop"'), sort: '-at', expand: 'user'
      });
      const hit = rows.items.find((c) => c.expand?.user?.is_admin);
      override = hit?.stop ? { stopId: hit.stop, at: hit.at } : null;
    } catch {
      override = null;
    }
  }

  async function loadTrains() {
    if (!here?.stop || !here.nextStop || !itinerary) { trips = []; return; }
    try {
      const res = await fetchNext(here.stop.station_id, here.nextStop.station_id, itinerary.event_date, now);
      trips = res.trips;
      mode = res.mode;
    } catch {
      trips = [];
    }
  }

  async function loadAlerts() {
    try {
      const res = await fetchAlerts();
      alerts = res.alerts;
      rtFetchedAt = res.fetchedAt;
    } catch {
      alerts = [];
    }
  }

  async function setStop(stop: Stop) {
    if (!$auth.user) return;
    try {
      await pb.collection('checkins').create({ user: $auth.user.id, stop: stop.id, kind: 'at_stop', at: new Date().toISOString() });
      picking = false;
      await loadOverride();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  $effect(() => {
    void loadRoute();
    void loadAlerts();
    void fetchStatus().then((s) => { rtFetchedAt = s.rtFetchedAt; mode = s.mode; }).catch(() => {});
    // The board re-reads the clock every 15 s and the feeds every 30 s.
    const tick = setInterval(() => { now = new Date(); }, 15_000);
    const poll = setInterval(() => { void loadTrains(); void loadAlerts(); }, 30_000);
    const unsubs = [
      subscribe('stops', '', loadRoute),
      subscribe('legs', '', loadRoute),
      subscribe('checkins', '', loadOverride)
    ];
    return () => { clearInterval(tick); clearInterval(poll); unsubs.forEach((u) => u()); };
  });

  // Re-ask for trains whenever the leg we are counting down changes.
  $effect(() => { void here?.stop?.id; void here?.nextStop?.id; void loadTrains(); });
</script>

<svelte:head><title>{copy.live}</title></svelte:head>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if !itinerary || !isToday}
  <p data-testid="no-active-route">{copy.noActiveRoute} <a href="/plan">{copy.backToPlanner}</a></p>
{:else if here?.stop}
  <AlertBubbles {alerts} onopen={() => goto('/notifications')} />
  <DepartureBoard
    station={here.stop.station_name || here.stop.station_id}
    stopName={here.stop.name}
    nextStation={here.nextStop?.station_name || here.nextStop?.station_id || ''}
    {trip}
    walkMin={here.stop.walk_min}
    {now}
    {mode}
    {rtFetchedAt}
    canCorrect={isAdmin}
    oncorrect={() => (picking = true)} />

  {#if picking}
    <section class="picker">
      <h2>{copy.setOurStopTitle}</h2>
      {#each stops as stop (stop.id)}
        <button type="button" class="secondary" onclick={() => setStop(stop)}>{stop.name} · {stop.station_name}</button>
      {/each}
    </section>
  {/if}

  <section class="rest">
    <h2>{copy.stillToCome}</h2>
    {#each remaining as stop (stop.id)}
      {@const leg = legs.find((l) => l.to_stop === stop.id)}
      <div class="row">
        <span class="when">{leg?.arrive_at ? fmtTime(leg.arrive_at) : ''}</span>
        <span class="name">{stop.name}</span>
        <span class="where">{stop.station_name}</span>
      </div>
    {/each}
  </section>
{/if}

<style>
  .rest, .picker { padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .row { display: flex; align-items: baseline; gap: 12px; padding: 11px 0; border-bottom: 1px solid #2a2a2a; }
  .when { font-variant-numeric: tabular-nums; font-size: 15px; color: #9a9a9a; width: 68px; flex: none; }
  .name { flex-grow: 1; font-size: 16px; }
  .where { font-size: 13px; color: #9a9a9a; }
</style>
