<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  // The shared `liveDay` owns the data so a Tab tap reaches every screen through the same tally.
  import { goto } from '$app/navigation';
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { auth, pb } from '$lib/pb';
  import type { DrinkEntry, DrinkKind } from '$lib/types';
  import { liveDay } from '$lib/live/day.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import TabRow from '$lib/components/TabRow.svelte';

  let error = $state('');
  const here = $derived(liveDay.here);
  // The board retains a stop before and after the crawl, when the Tab must stay closed.
  const tabStop = $derived(here?.source === 'clock' || here?.source === 'override' ? here.stop : null);
  const remaining = $derived(liveDay.stops.filter((s) => s.order > (here?.stop?.order ?? 0)));

  async function logDrink(kind: DrinkKind) {
    const stop = tabStop, user = $auth.user;
    if (!stop || !user) return;
    error = '';
    try {
      await pb.collection('drink_entries').create({ user: user.id, stop: stop.id, kind, at: new Date().toISOString() });
      await liveDay.loadDrinks();
    } catch { error = copy.noSignal; }
  }

  async function undoDrink(entry: DrinkEntry) {
    error = '';
    try { await pb.collection('drink_entries').delete(entry.id); await liveDay.loadDrinks(); }
    catch { error = copy.noSignal; }
  }
</script>

<svelte:head><title>{copy.live}</title></svelte:head>

{#if !liveDay.itinerary || !liveDay.isToday}
  <p data-testid="no-active-route">{copy.noActiveRoute} <a href="/plan">{copy.backToPlanner}</a></p>
{:else if here?.stop}
  <AlertBubbles alerts={liveDay.alerts} onopen={() => goto('/notifications')} />
  <DepartureBoard
    station={here.stop.station_name || here.stop.station_id}
    stopName={here.stop.name}
    nextStation={here.onwardStop?.station_name || here.onwardStop?.station_id || ''}
    trip={liveDay.trip}
    walkMin={here.stop.walk_min}
    now={liveDay.now}
    mode={liveDay.mode}
    rtFetchedAt={liveDay.rtFetchedAt} />
{/if}

{#if tabStop && $auth.user}
  <TabRow entries={liveDay.drinks} stopId={tabStop.id} userId={$auth.user.id}
    onlog={(kind) => void logDrink(kind)} onundo={(entry) => void undoDrink(entry)} />
{:else}
  <section class="tabclosed"><h2>{copy.tabTitle}</h2><p>{copy.tabClosed}</p></section>
{/if}
{#if error}<p role="alert">{error}</p>{/if}

{#if here?.stop}
  <section class="rest">
    <h2>{copy.stillToCome}</h2>
    {#each remaining as stop (stop.id)}
      {@const leg = liveDay.legs.find((l) => l.to_stop === stop.id)}
      <div class="row">
        <span class="when">{leg?.arrive_at ? fmtTime(leg.arrive_at) : ''}</span>
        <span class="name">{stop.name}</span>
        <span class="where">{stop.station_name}</span>
      </div>
    {/each}
  </section>
{/if}

<style>
  .rest, .tabclosed { padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .row { display: flex; align-items: baseline; gap: 12px; padding: 11px 0; border-bottom: 1px solid #2a2a2a; }
  .when { font-variant-numeric: tabular-nums; font-size: 15px; color: #9a9a9a; width: 68px; flex: none; }
  .name { flex-grow: 1; font-size: 16px; }
  .where { font-size: 13px; color: #9a9a9a; }
</style>
