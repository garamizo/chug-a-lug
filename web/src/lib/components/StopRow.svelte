<script lang="ts">
  // One stop card on the line map: number, name, times, either the departure (which train to
  // catch, on the last stop at a station) or a plain layover, and the train leg that leaves this
  // stop. Order is fixed by the line; only stops at the same station can be swapped, with the
  // small arrows in the corner next to the ×.
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { dwellOptions } from '$lib/dwell';
  import { fmtDur, fmtTime } from '$lib/time';
  import type { Leg, NextTrip, Stop } from '$lib/types';
  import type { Side } from '$lib/lineMap';
  import LegRow from './LegRow.svelte';

  let { stop, index, arriveAt, leaveAt, editable, last, href, side = 'left', leg, legReason, names, nextStationId, date, canUp = false, canDown = false, onupdate, onmove, onremove }: {
    stop: Stop; index: number; arriveAt: Date | null; leaveAt: Date | null; editable: boolean; last: boolean;
    href: string; side?: Side; leg: Leg | undefined; legReason?: string; names: Record<string, string>;
    /** Where the crawl goes next, so the departure options are that day's trains toward it. */
    nextStationId?: string; date: string;
    /** Whether the previous / next stop is at the same station (the only moves allowed). */
    canUp?: boolean; canDown?: boolean;
    onupdate: (patch: Partial<Stop>) => Promise<void>; onmove?: (dir: -1 | 1) => void; onremove: () => void;
  } = $props();

  const kind = $derived(copy[`kind_${stop.kind ?? 'other'}`]);
  // The last stop at a station picks the train out; earlier stops at the same station (and the
  // crawl's last stop) just pick how long to stay.
  const byTrain = $derived(editable && !!nextStationId && nextStationId !== stop.station_id);

  // Trains from this station toward the next stop, departing after the crawl could be at the
  // platform with no layover at all. Refetched when the arrival, the walk, or the next stop changes.
  let trips = $state<NextTrip[]>([]);
  $effect(() => {
    const from = stop.station_id, to = nextStationId, at = arriveAt, walk = stop.walk_min;
    trips = [];
    if (!editable || !to || to === from || !at) return;
    // (byTrain, spelled out so the effect tracks exactly these.)
    const after = new Date(at.getTime() + walk * 60_000).toISOString();
    let live = true;
    api<{ trips: NextTrip[] }>(`/api/metra/next?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}&after=${encodeURIComponent(after)}&limit=6`)
      .then((r) => { if (live) trips = r.trips; })
      .catch(() => { /* the select falls back to plain steps */ });
    return () => { live = false; };
  });
  const options = $derived(dwellOptions(arriveAt, stop.walk_min, trips, stop.dwell_min));
  const optionLabel = (o: { value: number; depart?: Date; current?: boolean }) =>
    o.depart ? `${fmtTime(o.depart)} · ${fmtDur(o.value)} ${copy.layoverLower}` : o.current && trips.length ? `${fmtDur(o.value)} ${copy.layoverLower} (${copy.current})` : fmtDur(o.value);

  async function pickDwell(event: Event) {
    const v = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(v) && v !== stop.dwell_min) await onupdate({ dwell_min: v });
  }
</script>

<article class="stop" data-testid="stop-row-{index}" data-side={side}>
  {#if editable}
    <div class="corner">
      {#if canUp}<button type="button" class="tiny" onclick={() => onmove?.(-1)} aria-label={copy.moveUp} data-testid="up-{index}">↑</button>{/if}
      {#if canDown}<button type="button" class="tiny" onclick={() => onmove?.(1)} aria-label={copy.moveDown} data-testid="down-{index}">↓</button>{/if}
      <button type="button" class="tiny close" onclick={() => { if (confirm(copy.removeConfirm)) onremove(); }} aria-label={copy.remove} data-testid="remove-{index}">×</button>
    </div>
  {/if}
  <a {href} class="head" data-testid="stop-link-{index}"><span class="num">{index + 1}</span><strong>{stop.name}</strong></a>
  <p class="meta">{kind} · {names[stop.station_id] ?? stop.station_name ?? stop.station_id} · {stop.walk_min} {copy.walkMinutes}</p>
  <p class="times">
    {#if arriveAt}<span>{copy.arrive} <strong>{fmtTime(arriveAt)}</strong></span>{/if}
    {#if leaveAt}<span>{copy.leave} <strong>{fmtTime(leaveAt)}</strong></span>{/if}
  </p>
  {#if editable}
    <label class="inline">{byTrain ? copy.departure : copy.layover}
      <select value={String(stop.dwell_min)} onchange={pickDwell} data-testid="dwell-{index}">
        {#each options as o (o.value)}<option value={String(o.value)}>{optionLabel(o)}</option>{/each}
      </select>
    </label>
  {:else}
    <p class="meta">{fmtDur(stop.dwell_min)} {copy.layoverLower}</p>
  {/if}
  {#if !last}<LegRow {leg} {index} {names} reason={legReason} />{/if}
</article>

<style>
  .stop { position: relative; background: #1b1b1b; border: 1px solid #333; border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; text-align: left; font-size: 15px; }
  .corner { position: absolute; top: 4px; right: 4px; display: flex; gap: 2px; }
  .tiny { width: 32px; height: 32px; margin: 0; padding: 0; background: transparent; color: #999; border: 0; font-size: 18px; line-height: 1; border-radius: 50%; }
  .tiny.close { font-size: 24px; }
  .tiny:hover { color: #fff; background: #2a2a2a; }
  .head { display: flex; gap: 8px; align-items: center; color: inherit; text-decoration: none; padding-right: 36px; }
  .stop:has(.corner > :nth-child(2)) .head { padding-right: 70px; }
  .stop:has(.corner > :nth-child(3)) .head { padding-right: 104px; }
  .num { flex: 0 0 24px; height: 24px; border-radius: 50%; background: #ffb400; color: #111; font-weight: 800; font-size: 13px; display: grid; place-items: center; }
  .head strong { overflow-wrap: anywhere; }
  .meta { color: #aaa; font-size: 13px; margin: 6px 0 0; line-height: 1.4; }
  .times { display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 6px 0 0; font-size: 14px; color: #ccc; line-height: 1.4; }
  .inline { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 0; font-size: 13px; color: #aaa; }
  .inline select { font: inherit; font-size: 15px; padding: 10px; width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid #555; background: #202020; color: #fff; }
  .stop :global(.leg) { margin-top: 8px; padding: 6px 0 2px 10px; font-size: 13px; }
</style>
