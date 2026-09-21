<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  // The data itself is owned by the shared `liveDay`, started in the app layout; this screen only
  // reads it.
  import { goto } from '$app/navigation';
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { liveDay } from '$lib/live/day.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';

  const here = $derived(liveDay.here);
  const remaining = $derived(liveDay.stops.filter((s) => s.order > (here?.stop?.order ?? 0)));
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
  .rest { padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .row { display: flex; align-items: baseline; gap: 12px; padding: 11px 0; border-bottom: 1px solid #2a2a2a; }
  .when { font-variant-numeric: tabular-nums; font-size: 15px; color: #9a9a9a; width: 68px; flex: none; }
  .name { flex-grow: 1; font-size: 16px; }
  .where { font-size: 13px; color: #9a9a9a; }
</style>
