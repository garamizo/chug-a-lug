<script lang="ts">
  import { pb } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { fmtDate, localToUtc, parseHm } from '$lib/time';
  import type { Itinerary, Leg, Stop } from '$lib/types';
  import StopRow from './StopRow.svelte';
  import LegRow from './LegRow.svelte';

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
  async function move(i: number, dir: -1 | 1) {
    if (!sorted[i] || !sorted[i + dir]) return;
    // Swap the two, then renumber 1..n so every stop has a unique order even after concurrent adds.
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
{#if sorted.length === 0}<p>{copy.noStops}</p>{/if}
<div class="list">
  {#each sorted as stop, i (stop.id)}
    <StopRow {stop} index={i} arriveAt={arriveAt(i)} leaveAt={leaveAt(i)} {editable} first={i === 0} last={i === sorted.length - 1}
      href="/plan/{itinerary.id}/stops/{stop.id}" onupdate={(patch) => update(stop, patch)} onmove={(dir) => move(i, dir)} onremove={() => remove(stop)} />
    {#if i < sorted.length - 1}<LegRow leg={legAfter(i)} index={i} {names} />{/if}
  {/each}
</div>
{#if editable}<a class="button" href="/plan/{itinerary.id}/add" data-testid="add-stop">{copy.addStop}</a>{/if}

<style>
  .it h1 { margin-bottom: 4px; }
  .meta { margin: 4px 0; color: #aaa; font-size: 15px; }
  .inline { display: flex; align-items: center; gap: 10px; margin: 8px 0 0; font-size: 15px; }
  .inline input { width: auto; margin: 0; padding: 8px; font-size: 16px; }
  h2 { font-size: 18px; margin-top: 28px; }
  .list { border-top: 1px solid #444; }
  .list :global(article) { border-bottom: 1px solid #333; }
  a.button { display: block; text-align: center; background: #ffb400; color: #111; font-weight: 700; padding: 14px; border-radius: 10px; text-decoration: none; margin-top: 20px; min-height: 48px; }
</style>
