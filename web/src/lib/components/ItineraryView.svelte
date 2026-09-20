<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb } from '$lib/pb';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { fmtDate, fmtWeekday, localToUtc, parseHm } from '$lib/time';
  import { PLANNER_ROUTE, placeStops, plannerStations, type Side } from '$lib/lineMap';
  import type { Itinerary, Leg, Line, Station, Stop } from '$lib/types';
  import LineMap from './LineMap.svelte';
  import StopRow from './StopRow.svelte';

  let { itinerary, stops, legs, editable, canManage, onerror }: {
    itinerary: Itinerary; stops: Stop[]; legs: Leg[]; editable: boolean; canManage: boolean; onerror?: (message: string) => void;
  } = $props();

  const sorted = $derived([...stops].sort((a, b) => a.order - b.order || a.created.localeCompare(b.created)));
  const names = $derived(Object.assign(
    {},
    ...sorted.map((s) => ({ [s.station_id]: s.station_name || s.station_id })),
    { OTC: copy.stationOTC, CUS: copy.stationCUS }
  ));
  const legAfter = (i: number) => legs.find((l) => l.from_stop === sorted[i].id && l.to_stop === sorted[i + 1]?.id);
  const arriveAt = (i: number): Date | null => {
    if (i === 0) return localToUtc(itinerary.event_date, parseHm(itinerary.start_time));
    const leg = legAfter(i - 1);
    return leg ? new Date(leg.arrive_at) : null;
  };
  const leaveAt = (i: number): Date | null => {
    const leg = legAfter(i);
    if (leg) return new Date(leg.ready_at);
    const a = arriveAt(i);
    return a ? new Date(a.getTime() + sorted[i].dwell_min * 60_000) : null;
  };

  // The planner line, top to bottom. null while loading; [] when the schedule could not be
  // fetched, in which case the stops are listed without the map.
  let stations = $state<Station[] | null>(null);
  let lineColor = $state('#29C233');
  onMount(async () => {
    try {
      const { lines } = await api<{ lines: Line[] }>(`/api/metra/stations?date=${encodeURIComponent(itinerary.event_date)}`);
      stations = plannerStations(lines);
      lineColor = lines.find((l) => l.routeId === PLANNER_ROUTE)?.color ?? lineColor;
    } catch { stations = []; }
  });
  const placement = $derived(placeStops(stations ?? [], sorted));
  const stationLabel = (s: Station) => ({ OTC: copy.stationOTC, CUS: copy.stationCUS } as Record<string, string>)[s.id] ?? s.name;
  // Stations no train stops at on the crawl date (Metra skips a few on weekends). A leg from or
  // to one can never work, and the message should say so rather than blame the layover.
  const unserved = $derived(new Set((stations ?? []).filter((s) => s.served === false).map((s) => s.id)));
  const legReason = (i: number): string | undefined => {
    const bad = [sorted[i], sorted[i + 1]].find((s) => s && unserved.has(s.station_id));
    return bad ? `${names[bad.station_id]} ${copy.noServiceLeg} ${fmtWeekday(itinerary.event_date)}. ${copy.noServiceHint}` : undefined;
  };

  // Which pane is in focus: the outbound (toward Chicago, left) or the return (right). Empty
  // stations are labelled on the focused side so the name is readable there.
  let focused = $state<Side>('left');
  let map: { focusSide: (side: Side) => void } | undefined = $state();

  // Adding a stop leaves and comes back; remember where the page was scrolled so the crawl does
  // not jump back to the top every time.
  const scrollKey = $derived(`scroll:/plan/${itinerary.id}`);
  function addAt(s: Station) {
    try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { /* private mode */ }
    // The side of the map the circle was tapped on is the new stop's direction.
    void goto(`/plan/${itinerary.id}/add?station=${encodeURIComponent(s.id)}&side=${focused}`);
  }
  $effect(() => {
    if (stations === null) return;
    let y: string | null = null;
    try { y = sessionStorage.getItem(scrollKey); if (y !== null) sessionStorage.removeItem(scrollKey); } catch { /* private mode */ }
    if (y !== null) void tick().then(() => window.scrollTo(0, Number(y)));
  });
  const sameStation = (i: number, j: number) => !!sorted[i] && !!sorted[j] && sorted[i].station_id === sorted[j].station_id && placement.side[i] === placement.side[j];

  // Sentinel-initialized (not read from `itinerary` directly) so svelte-check doesn't flag
  // state_referenced_locally; the effect below does the real sync, guarded so an unchanged
  // reload doesn't clobber an in-progress edit of the start-time field.
  let syncedStartTime: string | undefined = $state(undefined);
  let startTime = $state('');
  $effect(() => {
    if (itinerary.start_time !== syncedStartTime) {
      syncedStartTime = itinerary.start_time;
      startTime = itinerary.start_time;
    }
  });

  const fail = (err: unknown) => onerror?.((err as Error).message || copy.genericError);

  async function saveStart() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || startTime === itinerary.start_time) return;
    try { await pb.collection('itineraries').update(itinerary.id, { start_time: startTime }); } catch (err) { fail(err); }
  }
  async function update(stop: Stop, patch: Partial<Stop>) {
    try { await pb.collection('stops').update(stop.id, patch); } catch (err) { fail(err); }
  }
  // Only stops at the same station swap places; the line fixes everything else.
  async function move(i: number, dir: -1 | 1) {
    if (!sameStation(i, i + dir)) return;
    const next = [...sorted];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    try {
      for (const [idx, s] of next.entries()) {
        if (s.order !== idx + 1) await pb.collection('stops').update(s.id, { order: idx + 1 });
      }
    } catch (err) { fail(err); }
  }
  async function remove(stop: Stop) {
    try { await pb.collection('stops').delete(stop.id); } catch (err) { fail(err); }
  }
</script>

{#snippet card(i: number)}
  {@const stop = sorted[i]}
  <StopRow {stop} index={i} arriveAt={arriveAt(i)} leaveAt={leaveAt(i)} {editable} last={i === sorted.length - 1}
    side={placement.side[i]} leg={legAfter(i)} legReason={legReason(i)} {names} nextStationId={sorted[i + 1]?.station_id} date={itinerary.event_date}
    canUp={sameStation(i, i - 1)} canDown={sameStation(i, i + 1)}
    href="/plan/{itinerary.id}/stops/{stop.id}" onupdate={(patch) => update(stop, patch)} onmove={(dir) => move(i, dir)} onremove={() => remove(stop)} />
{/snippet}

{#snippet label(station: Station, i: number)}
  <span class="name" class:terminal={i === 0 || i === stations!.length - 1} class:off={station.served === false}>{stationLabel(station)}{#if station.served === false}<small> · {copy.noTrainsShort} {fmtWeekday(itinerary.event_date, 'short')}</small>{/if}</span>
{/snippet}

<header class="it">
  <h1>{itinerary.title}</h1>
  <p class="meta">{copy.eventDate}: <strong>{fmtDate(itinerary.event_date)}</strong></p>
  {#if canManage}
    <label class="inline">{copy.startTime} <input type="time" bind:value={startTime} onchange={saveStart} data-testid="start-time" /></label>
  {:else}
    <p class="meta">{copy.startTime} <strong>{itinerary.start_time}</strong></p>
  {/if}
</header>

<h2>{copy.stops}</h2>
{#if sorted.length === 0}<p>{editable ? copy.noStopsTap : copy.noStops}</p>{/if}
{#if stations === null}
  <p>{copy.working}</p>
{:else if stations.length}
  <div class="tabs" role="tablist">
    <button type="button" role="tab" class="tab" aria-selected={focused === 'left'} onclick={() => map?.focusSide('left')} data-testid="side-left">{copy.inbound}</button>
    <button type="button" role="tab" class="tab" aria-selected={focused === 'right'} onclick={() => map?.focusSide('right')} data-testid="side-right">{copy.outbound}</button>
  </div>
  <LineMap bind:this={map} {stations} color={lineColor} panes onside={(s) => (focused = s)}
    onpick={editable ? addAt : undefined} pickLabel={(s) => `${copy.addAt} ${stationLabel(s)}`}>
    {#snippet left(station, i)}
      <div class="rowhead">{#if focused === 'left'}{@render label(station, i)}{/if}</div>
      {#each placement.rows[i].left as k (sorted[k].id)}{@render card(k)}{/each}
    {/snippet}
    {#snippet right(station, i)}
      <div class="rowhead">{#if focused === 'right'}{@render label(station, i)}{/if}</div>
      {#each placement.rows[i].right as k (sorted[k].id)}{@render card(k)}{/each}
    {/snippet}
  </LineMap>
  {#if placement.offLine.length}
    <h3>{copy.offLine}</h3>
    <div class="list">{#each placement.offLine as k (sorted[k].id)}{@render card(k)}{/each}</div>
  {/if}
{:else}
  <div class="list">{#each placement.offLine as k (sorted[k].id)}{@render card(k)}{/each}</div>
{/if}
{#if editable && stations !== null && !stations.length}<a class="button" href="/plan/{itinerary.id}/add" data-testid="add-stop">{copy.addStop}</a>{/if}

<style>
  .it h1 { margin-bottom: 4px; }
  .meta { margin: 4px 0; color: #aaa; font-size: 15px; }
  .inline { display: flex; align-items: center; gap: 10px; margin: 8px 0 0; font-size: 15px; }
  .inline input { width: auto; margin: 0; padding: 8px; font-size: 16px; }
  h2 { font-size: 18px; margin-top: 28px; }
  h3 { font-size: 15px; color: #aaa; margin: 20px 0 8px; }
  .tabs { display: flex; gap: 6px; margin: 0 0 10px; }
  .tab { flex: 1; margin: 0; padding: 8px; min-height: 44px; font-size: 14px; font-weight: 600; background: transparent; color: #aaa; border: 1px solid #444; border-radius: 10px; }
  .tab[aria-selected='true'] { background: #2a2a2a; color: #fff; border-color: #777; }
  /* The station name sits at circle height; cards start below it on both sides. */
  .rowhead { height: 36px; }
  .name { display: inline-block; padding: 14px 6px 0; font-size: 13px; color: #888; line-height: 1.3; white-space: nowrap; }
  .name.terminal { font-size: 15px; font-weight: 800; color: #eee; }
  .name.off { color: #666; }
  .name small { font-size: 11px; }
  .list { max-width: 320px; }
  a.button { display: block; text-align: center; background: #ffb400; color: #111; font-weight: 700; padding: 14px; border-radius: 10px; text-decoration: none; margin-top: 20px; min-height: 48px; }
</style>
