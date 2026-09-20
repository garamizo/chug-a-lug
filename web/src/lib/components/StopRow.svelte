<script lang="ts">
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import type { Stop } from '$lib/types';

  let { stop, index, arriveAt, leaveAt, editable, first, last, href, onupdate, onmove, onremove }: {
    stop: Stop; index: number; arriveAt: Date | null; leaveAt: Date | null; editable: boolean; first: boolean; last: boolean;
    href: string; onupdate: (patch: Partial<Stop>) => Promise<void>; onmove: (dir: -1 | 1) => void; onremove: () => void;
  } = $props();

  // Sentinel-initialized (not read from `stop` directly) so svelte-check doesn't flag
  // state_referenced_locally; the effect below does the real sync, guarded so an unchanged
  // reload (e.g. a realtime refresh after someone else's edit) doesn't clobber in-progress typing.
  let syncedDwell: number | undefined = $state(undefined);
  let dwell = $state(0);
  $effect(() => {
    if (stop.dwell_min !== syncedDwell) {
      syncedDwell = stop.dwell_min;
      dwell = stop.dwell_min;
    }
  });
  const kind = $derived(copy[`kind_${stop.kind ?? 'other'}`]);

  async function commitDwell() {
    const v = Math.max(0, Math.min(600, Math.round(Number(dwell) || 0)));
    if (v !== stop.dwell_min) await onupdate({ dwell_min: v });
  }
</script>

<article class="stop" data-testid="stop-row-{index}">
  <div class="head">
    <span class="num">{index + 1}</span>
    <a {href} data-testid="stop-link-{index}"><strong>{stop.name}</strong><span class="meta">{kind} · {stop.station_name || stop.station_id} · {stop.walk_min} {copy.walkMinutes}</span></a>
  </div>
  <div class="times">
    {#if arriveAt}<span>{copy.arrive} <strong>{fmtTime(arriveAt)}</strong></span>{/if}
    {#if leaveAt}<span>{copy.leave} <strong>{fmtTime(leaveAt)}</strong></span>{/if}
  </div>
  {#if editable}
    <div class="controls">
      <label class="inline"><input type="number" min="0" max="600" step="15" bind:value={dwell} onchange={commitDwell} data-testid="dwell-{index}" /> {copy.layoverMinutes}</label>
      <button type="button" class="secondary small" onclick={() => onmove(-1)} disabled={first} aria-label={copy.moveUp}>↑</button>
      <button type="button" class="secondary small" onclick={() => onmove(1)} disabled={last} aria-label={copy.moveDown}>↓</button>
      <button type="button" class="secondary small" onclick={() => { if (confirm(copy.removeConfirm)) onremove(); }} data-testid="remove-{index}">{copy.remove}</button>
    </div>
  {:else}
    <p class="meta">{stop.dwell_min} {copy.layoverMinutes}</p>
  {/if}
</article>

<style>
  .stop { padding: 14px 0; }
  .head { display: flex; gap: 12px; align-items: flex-start; }
  .num { flex: 0 0 28px; height: 28px; border-radius: 50%; background: #ffb400; color: #111; font-weight: 800; display: grid; place-items: center; }
  .head a { color: inherit; text-decoration: none; display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .meta { color: #aaa; font-size: 14px; margin: 4px 0 0; }
  .times { display: flex; gap: 18px; margin: 8px 0 0 40px; font-size: 15px; color: #ccc; }
  .controls { display: flex; gap: 8px; align-items: center; margin: 10px 0 0 40px; flex-wrap: wrap; }
  .inline { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; }
  .inline input { width: 84px; margin: 0; padding: 8px; font-size: 16px; }
  .small { width: auto; min-height: 48px; padding: 6px 12px; margin: 0; font-size: 15px; }
</style>
