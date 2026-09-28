<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { fmtDate, fmtTime, fmtWeekday, localToUtc, parseHm } from '$lib/time';
  import { PLANNER_ROUTE, placeStops, plannerStations, sideOfSection, unfold, type Section, type SectionRow } from '$lib/lineMap';
  import { finishAt } from '$lib/routeStats';
  import type { Itinerary, Leg, Line, Station, Stop, StopLike } from '$lib/types';
  import { stopPhoto } from '$lib/photo';
  import type { PlanActions } from '$lib/planActions';
  import LineMap from './LineMap.svelte';
  import StopRow from './StopRow.svelte';
  import LegRow from './LegRow.svelte';

  let { itinerary, stops, legs, editable, canManage, actions, onerror, onopenstop, photos, builder, current, belowHeader }: {
    itinerary: Itinerary; stops: StopLike[]; legs: Leg[]; editable: boolean; canManage: boolean; actions: PlanActions; onerror?: (message: string) => void;
    /** Card photos by stop id, for staged stops that carry no place; otherwise read off each stop. */
    photos?: Record<string, string>;
    /** When set, stop links open the stop sheet in place of navigating to the planning page. */
    onopenstop?: (id: string) => void;
    /** The route's builder, for the "by <name>" chip; omitted when the caller has no expand to offer. */
    builder?: string;
    /** Whether this is the current locked route (Live follows it); adds the gold "Current" chip. */
    current?: boolean;
    /** Rendered right under the header, above the line — the view page's cheers pills. */
    belowHeader?: Snippet;
  } = $props();

  const sorted = $derived([...stops].sort((a, b) => a.order - b.order || (a.created ?? '').localeCompare(b.created ?? '')));
  const names = $derived(Object.assign(
    {},
    ...sorted.map((s) => ({ [s.station_id]: s.station_name || s.station_id })),
    ...(itinerary.start_station ? [{ [itinerary.start_station]: itinerary.start_station_name || itinerary.start_station }] : []),
    { OTC: copy.stationOTC, CUS: copy.stationCUS }
  ));
  // The ride in from Board at to stop 1: the one leg with no from_stop. legAfter never matches it.
  const opening = $derived(legs.find((l) => !l.from_stop && l.to_stop === sorted[0]?.id));
  const legAfter = (i: number) => legs.find((l) => !!l.from_stop && l.from_stop === sorted[i].id && l.to_stop === sorted[i + 1]?.id);
  const arriveAt = (i: number): Date | null => {
    if (i === 0) return opening ? new Date(opening.arrive_at) : localToUtc(itinerary.event_date, parseHm(itinerary.start_time));
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
  // The line as the day is ridden: toward Chicago top to bottom, then every station again on the way back.
  const sections = $derived(unfold(placement));
  const halves = $derived([['out', sections.out], ['back', sections.back]] as [Section, SectionRow[]][]);
  const stationLabel = (s: Station) => ({ OTC: copy.stationOTC, CUS: copy.stationCUS } as Record<string, string>)[s.id] ?? s.name;
  // Stations no train stops at on the crawl date (Metra skips a few on weekends). A leg from or
  // to one can never work, and the message should say so rather than blame the layover.
  const unserved = $derived(new Set((stations ?? []).filter((s) => s.served === false).map((s) => s.id)));
  const legReason = (i: number): string | undefined => {
    const bad = [sorted[i], sorted[i + 1]].find((s) => s && unserved.has(s.station_id));
    return bad ? `${names[bad.station_id]} ${copy.noServiceLeg} ${fmtWeekday(itinerary.event_date)}. ${copy.noServiceHint}` : undefined;
  };

  // Adding a stop leaves and comes back; remember where the page was scrolled so the crawl does
  // not jump back to the top every time.
  const scrollKey = $derived(`scroll:/plan/${itinerary.id}`);
  function rememberScroll() {
    try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { /* private mode */ }
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

  const finish = $derived(finishAt(sorted.map((_, i) => leaveAt(i))));

</script>

{#snippet card(i: number)}
  {@const stop = sorted[i]}
  {#if i === 0 && opening}
    <div class="opening" data-testid="opening-leg">
      <p class="meta">{copy.boardAt} {itinerary.start_station_name || itinerary.start_station} · {itinerary.start_time}</p>
      <LegRow leg={opening} index={-1} {names} />
    </div>
  {/if}
  <StopRow {stop} photo={photos ? photos[stop.id] ?? null : stopPhoto(stop as Stop)} index={i} arriveAt={arriveAt(i)} leaveAt={leaveAt(i)} {editable} last={i === sorted.length - 1}
    side={placement.side[i]} leg={legAfter(i)} legReason={legReason(i)} {names} nextStationId={sorted[i + 1]?.station_id} date={itinerary.event_date}
    canUp={sameStation(i, i - 1)} canDown={sameStation(i, i + 1)}
    href="/plan/{itinerary.id}/stops/{stop.id}" onopen={onopenstop}
    onupdate={(patch) => { if (patch.dwell_min !== undefined) return actions.setDwell(stop.id, patch.dwell_min); }}
    onmove={(dir) => actions.move(stop.id, dir)} onremove={() => actions.remove(stop.id)} />
  {#if actions.setAnchor}
    <div class="under">
      <button type="button" class="here" class:on={actions.anchorStopId === stop.id}
        onclick={() => actions.setAnchor?.(stop.id)} data-testid="set-here-{i}">
        {actions.anchorStopId === stop.id ? copy.crewIsHere : copy.crewIsHereSet}
      </button>
    </div>
  {/if}
{/snippet}

{#snippet label(station: Station, i: number, n: number)}
  <span class="name" class:terminal={i === 0 || i === n - 1} class:off={station.served === false}>{stationLabel(station)}{#if station.served === false}<small> · {copy.noTrainsShort} {fmtWeekday(itinerary.event_date, 'short')}</small>{/if}</span>
{/snippet}

<header class="it">
  <span class="k">{itinerary.status === 'draft' ? copy.kindDraftRoute : itinerary.status === 'locked' ? copy.kindTheRoute : copy.kindArchived}</span>
  <h1>{itinerary.title}</h1>
  <div class="chips">
    {#if builder}<span class="chip">{copy.byBuilder} {builder}</span>{/if}
    <span class="chip">{fmtDate(itinerary.event_date)}</span>
    {#if itinerary.vote_open}<span class="chip go">{copy.voteOpenShort}</span>{/if}
    {#if current}<span class="chip gold">{copy.chipCurrent}</span>{/if}
  </div>
  <div class="stats">
    <div><strong>{sorted.length}</strong><small>{copy.statStops}</small></div>
    <div>
      {#if canManage && actions.setStartTime}
        <input type="time" aria-label={itinerary.start_station ? copy.startTimeBoard : copy.startTime} bind:value={startTime} onchange={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) && startTime !== itinerary.start_time) void actions.setStartTime?.(startTime); }} data-testid="start-time" />
      {:else}<strong>{itinerary.start_time}</strong>{/if}
      <small>{copy.statStart}</small>
    </div>
    <div><strong>{finish ? fmtTime(finish) : '—'}</strong><small>{copy.statFinish}</small></div>
  </div>
  {#if canManage && actions.setStartStation}
    <label class="board">{copy.boardAt}
      <select value={itinerary.start_station ?? ''} data-testid="board-at"
        onchange={(e) => { const id = (e.target as HTMLSelectElement).value; const st = (stations ?? []).find((s) => s.id === id); void actions.setStartStation?.(st ? { id: st.id, name: st.name } : null); }}>
        <option value="">{copy.boardAtPick}</option>
        {#each stations ?? [] as st (st.id)}<option value={st.id} disabled={st.served === false}>{stationLabel(st)}</option>{/each}
      </select>
    </label>
  {:else if itinerary.start_station}
    <p class="board">{copy.boardAt} <strong>{itinerary.start_station_name || itinerary.start_station}</strong></p>
  {/if}
</header>
{@render belowHeader?.()}

<h2>{copy.stops}</h2>
{#if sorted.length === 0}<p>{editable ? copy.noStopsTap : copy.noStops}</p>{/if}
{#if stations === null}
  <p>{copy.working}</p>
{:else if stations.length}
  {#each halves as [sec, rows] (sec)}
    {@const list = rows.map((r) => r.station)}
    <h3 class="dir" data-testid="section-{sec}">{sec === 'out' ? '▼' : '▲'} {sec === 'out' ? copy.inbound : copy.outbound}</h3>
    <LineMap stations={list} color={lineColor} section={sec}
      onpick={editable ? (s) => { rememberScroll(); actions.add(s.id, sideOfSection(sec)); } : undefined}
      pickLabel={(s) => `${copy.addAt} ${stationLabel(s)}`}>
      {#snippet cell(station, i)}
        {@render label(station, i, list.length)}
        {#each rows[i].stops as k (sorted[k].id)}{@render card(k)}{/each}
      {/snippet}
    </LineMap>
    {#if sec === 'out'}<p class="turn" aria-hidden="true">↩ {copy.turnAround}</p>{/if}
  {/each}
  {#if placement.offLine.length}
    <h3>{copy.offLine}</h3>
    <div class="list">{#each placement.offLine as k (sorted[k].id)}{@render card(k)}{/each}</div>
  {/if}
{:else}
  <div class="list">{#each placement.offLine as k (sorted[k].id)}{@render card(k)}{/each}</div>
{/if}
{#if editable && stations !== null && !stations.length}<a class="button" href="/plan/{itinerary.id}/add" data-testid="add-stop">{copy.addStop}</a>{/if}

<style>
  .it { background: var(--board-bg); border: 2px solid #333; border-radius: 12px; padding: 12px 14px; margin: 4px 0 12px; }
  .it .k { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); font-weight: 800; }
  .it h1 { font-family: var(--mono); color: var(--gold-soft); text-transform: uppercase; font-size: 24px; margin: 4px 0 8px; overflow-wrap: anywhere; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #222; color: #ccc; }
  .chip.go { background: var(--metra); color: #031; }
  .chip.gold { background: var(--gold); color: #111; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; border-top: 1px solid #222; margin-top: 10px; padding-top: 8px; }
  .stats strong { display: block; font-family: var(--mono); font-size: 20px; color: var(--gold); }
  .stats small { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #888; }
  .stats input { width: 100%; max-width: 110px; margin: 0 auto; padding: 4px; font-family: var(--mono); font-size: 18px; text-align: center; }
  .board { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 8px 0 0; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #888; }
  .board select { font-family: var(--mono); font-size: 15px; padding: 4px; max-width: 220px; }
  .board strong { font-family: var(--mono); font-size: 15px; letter-spacing: normal; text-transform: none; color: var(--gold); }
  .opening { margin: 0 0 6px; }
  .opening .meta { margin: 0; font-size: 12px; color: #888; }
  h2 { font-size: 18px; margin-top: 28px; }
  h3 { font-size: 15px; color: #aaa; margin: 20px 0 8px; }
  .dir { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); margin: 18px 0 6px 46px; }
  .turn { text-align: center; color: var(--metra); font-weight: 700; font-size: 13px; margin: 8px 0; }
  /* The station name sits at circle height, right of the line; its cards follow below it. */
  .name { display: block; padding: 14px 0 6px; font-size: 13px; color: #888; line-height: 1.3; }
  .name.terminal { font-size: 15px; font-weight: 800; color: #eee; }
  .name.off { color: #666; }
  .name small { font-size: 11px; }
  .list { max-width: 320px; }
  a.button { display: block; text-align: center; background: #ffb400; color: #111; font-weight: 700; padding: 14px; border-radius: 10px; text-decoration: none; margin-top: 20px; min-height: 48px; }
  .here { font-size: 13px; padding: 8px; min-height: 40px; margin-top: 8px; background: transparent; color: #ffce5c; border: 1px solid #555; border-radius: 9px; }
  .here.on { background: #ffb400; color: #111; border-color: #ffb400; }
</style>
