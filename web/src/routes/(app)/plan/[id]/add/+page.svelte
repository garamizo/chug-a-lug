<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { pb } from '$lib/pb';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { haversineM, walkMinutes } from '$lib/geo';
  import { PLANNER_ROUTE, insertionIndex, plannerStations, type Direction } from '$lib/lineMap';
  import Schematic from '$lib/components/Schematic.svelte';
  import type { Itinerary, Line, Station, Stop, Venue } from '$lib/types';

  const itineraryId = $derived(page.params.id!);
  let lines = $state<Line[]>([]);
  // The picker shows the planner line only (the crawl is settled on BNSF), Aurora at the top.
  const stations = $derived(plannerStations(lines));
  const lineColor = $derived(lines.find((l) => l.routeId === PLANNER_ROUTE)?.color ?? '#29C233');
  let station = $state<Station | null>(null);
  // Which way the crawl is heading at this stop: preset by the side of the map the circle was
  // tapped on, and switchable here.
  let direction = $state<Direction>('out');
  let nearby = $state<Venue[] | null>(null);
  let results = $state<Venue[] | null>(null);
  let query = $state('');
  let manual = $state('');
  let busy = $state('');
  let error = $state('');

  onMount(async () => {
    try {
      // The crawl date decides which stations have trains at all; the picker greys out the rest.
      const it = await pb.collection('itineraries').getOne<Itinerary>(itineraryId, { fields: 'event_date' });
      lines = (await api<{ lines: Line[] }>(`/api/metra/stations?date=${encodeURIComponent(it.event_date)}`)).lines;
    } catch (err) { error = (err as Error).message; return; }
    // Arriving from a station circle on the draft: skip the picker.
    if (page.url.searchParams.get('side') === 'right') direction = 'back';
    const wanted = page.url.searchParams.get('station');
    const preset = wanted && plannerStations(lines).find((s) => s.id === wanted);
    if (preset && preset.served !== false) void pick(preset);
  });

  async function pick(s: Station) {
    station = s; nearby = null; results = null; error = '';
    try { nearby = (await api<{ venues: Venue[] }>(`/api/places/nearby?station=${encodeURIComponent(s.id)}`)).venues; }
    catch (err) { nearby = null; error = (err as Error).message; }
  }

  async function search(event: SubmitEvent) {
    event.preventDefault();
    if (!station || query.trim().length < 2) return;
    busy = 'search'; error = '';
    try { results = (await api<{ venues: Venue[] }>(`/api/places/search?q=${encodeURIComponent(query.trim())}&station=${encodeURIComponent(station.id)}`)).venues; }
    catch (err) { results = null; error = (err as Error).message; }
    finally { busy = ''; }
  }

  async function add(venue: Venue) {
    if (!station || busy) return;
    busy = venue.id || 'manual'; error = '';
    try {
      // Slot the stop into the crawl: going stops top to bottom, then return stops bottom to top.
      // Later stops shift down one so every order stays unique.
      const current = await pb.collection('stops').getFullList<Stop>({ filter: pb.filter('itinerary = {:id}', { id: itineraryId }), sort: 'order,created' });
      const at = insertionIndex(stations, current, station.id, direction);
      for (const [i, s] of current.entries()) {
        if (i >= at && s.order !== i + 2) await pb.collection('stops').update(s.id, { order: i + 2 });
      }
      const stop = await pb.collection('stops').create<Stop>({
        itinerary: itineraryId, order: at + 1, direction, name: venue.name, kind: venue.kind, station_id: station.id, station_name: station.name,
        place: venue.placeRef ?? '', place_id: venue.source === 'google' ? venue.id : '', osm_id: venue.source === 'osm' ? venue.id : '',
        address: venue.address ?? '', lat: venue.lat, lon: venue.lon, hours: venue.hours ?? null, phone: venue.phone ?? '', website: venue.website ?? '',
        walk_min: walkMinutes(haversineM(station.lat, station.lon, venue.lat, venue.lon)), dwell_min: 60
      });
      void api('/api/places/attach', { method: 'POST', json: { stopId: stop.id } }).catch(() => undefined);
      await goto(`/plan/${itineraryId}/edit`);
    } catch (err) { error = (err as Error).message || copy.genericError; busy = ''; }
  }

  function addManual(event: SubmitEvent) {
    event.preventDefault();
    if (!station || manual.trim().length < 1) return;
    void add({ source: 'osm', id: '', name: manual.trim(), kind: 'bar', lat: station.lat, lon: station.lon });
  }

  const tid = (v: Venue) => `venue-${v.id.replace(/\//g, '-') || 'manual'}`;
  const rated = (v: Venue) => v.rating !== undefined ? ` · ★ ${v.rating.toFixed(1)}${v.ratingCount ? ` (${v.ratingCount})` : ''}` : '';
</script>

<p><a href="/plan/{itineraryId}/edit">← {copy.backToDraft}</a></p>
<h1>{copy.addStop}</h1>

{#if !station}
  <h2>{copy.pickStation}</h2>
  <p>{copy.pickStationHint}</p>
  {#if stations.length}<Schematic {stations} color={lineColor} onpick={pick} />{:else if !error}<p>{copy.working}</p>{/if}
{:else}
  <p class="meta"><strong>{station.name}</strong> · <button type="button" class="link" onclick={() => (station = null)}>{copy.changeStation}</button></p>
  <div class="tabs" role="radiogroup" aria-label={copy.direction}>
    <button type="button" class="tab" role="radio" aria-checked={direction === 'out'} onclick={() => (direction = 'out')} data-testid="dir-out">{copy.inbound}</button>
    <button type="button" class="tab" role="radio" aria-checked={direction === 'back'} onclick={() => (direction = 'back')} data-testid="dir-back">{copy.outbound}</button>
  </div>

  <h2>{copy.nearby} {station.name}</h2>
  {#if nearby === null}
    {#if !error}<p>{copy.loadingNearby}</p>{/if}
  {:else if nearby.length === 0}
    <p>{copy.noNearby}</p>
  {:else}
    <ul class="venues">
      {#each nearby as v (v.id)}
        <li><button type="button" onclick={() => add(v)} disabled={!!busy} data-testid={tid(v)}>
          <strong>{v.name}</strong><span>{copy[`kind_${v.kind}`]}{rated(v)} · {v.distanceM ?? 0} m{v.address ? ` · ${v.address}` : ''}</span>
        </button></li>
      {/each}
    </ul>
    <p class="attribution">{nearby[0].source === 'google' ? copy.googleAttribution : copy.osmAttribution}</p>
  {/if}

  <h2>{copy.searchByName}</h2>
  <form onsubmit={search}>
    <input bind:value={query} placeholder={copy.searchPlaceholder} minlength="2" data-testid="search-input" />
    <button type="submit" disabled={!!busy} data-testid="search-button">{busy === 'search' ? copy.searching : copy.search}</button>
  </form>
  {#if results}
    {#if results.length === 0}<p>{copy.noSearchResults}</p>{/if}
    <ul class="venues">
      {#each results as v (v.id)}
        <li><button type="button" onclick={() => add(v)} disabled={!!busy} data-testid={tid(v)}>
          <strong>{v.name}</strong><span>{copy[`kind_${v.kind}`]}{v.address ? ` · ${v.address}` : ''}</span>
        </button></li>
      {/each}
    </ul>
    {#if results.length}<p class="attribution">{copy.googleAttribution}</p>{/if}
  {/if}

  <h2>{copy.manualAdd}</h2>
  <form onsubmit={addManual}>
    <label for="manual">{copy.manualName}</label>
    <input id="manual" bind:value={manual} maxlength="120" data-testid="manual-name" />
    <button type="submit" disabled={!!busy} data-testid="manual-add">{busy && busy !== 'search' ? copy.adding : copy.add}</button>
  </form>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  h2 { font-size: 18px; margin-top: 28px; }
  .meta { color: #ccc; }
  .link { background: none; color: #ffce5c; border: 0; padding: 0; width: auto; min-height: 0; font-size: inherit; text-decoration: underline; }
  .tabs { display: flex; gap: 6px; margin: 12px 0 0; }
  .tab { flex: 1; margin: 0; padding: 8px; min-height: 44px; font-size: 14px; font-weight: 600; background: transparent; color: #aaa; border: 1px solid #444; border-radius: 10px; }
  .tab[aria-checked='true'] { background: #2a2a2a; color: #fff; border-color: #777; }
  .venues { list-style: none; padding: 0; margin: 8px 0; }
  .venues button { background: #202020; color: #eee; text-align: left; display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-weight: 500; }
  .venues span { color: #aaa; font-size: 14px; }
  .attribution { color: #888; font-size: 12px; }
</style>
