<script lang="ts">
  // Station picker: the line down the middle, one big button per station on the right, and a
  // plain select underneath for anyone who prefers a list.
  import { copy } from '$lib/labels';
  import LineMap from './LineMap.svelte';
  import type { Station } from '$lib/types';

  let { stations, color, selected, onpick }: { stations: Station[]; color: string; selected?: string; onpick: (station: Station) => void } = $props();

  function fromSelect(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    const station = stations.find((s) => s.id === id);
    if (station) onpick(station);
  }
</script>

<LineMap {stations} {color} {selected}>
  {#snippet right(station, i)}
    <button type="button" class="station" class:terminal={i === 0 || i === stations.length - 1} data-testid="station-{station.id}"
      aria-pressed={selected === station.id} disabled={station.served === false} onclick={() => onpick(station)}>{station.name}{#if station.served === false}<span class="off"> · {copy.noTrainsShort}</span>{/if}</button>
  {/snippet}
</LineMap>
<label for="station-select">{copy.stationList}</label>
<select id="station-select" data-testid="station-select" value={selected ?? ''} onchange={fromSelect}>
  <option value="" disabled>{copy.pickStation}</option>
  {#each stations as station}<option value={station.id} disabled={station.served === false}>{station.name}{station.served === false ? ` · ${copy.noTrainsShort}` : ''}</option>{/each}
</select>

<style>
  .station { display: block; width: 100%; margin: 0; padding: 12px 10px; min-height: 48px; text-align: left; background: transparent; color: #ddd; border: 0; border-radius: 10px; font-size: 16px; font-weight: 500; }
  .station:hover { background: #1c1c1c; }
  .station.terminal { font-weight: 800; color: #fff; }
  .station[aria-pressed='true'] { background: #2a2a2a; color: #fff; }
  .station:disabled { color: #666; opacity: 1; cursor: default; }
  .off { font-size: 13px; font-weight: 400; }
  select { font: inherit; font-size: 18px; padding: 14px; width: 100%; margin-top: 8px; border-radius: 10px; border: 1px solid #666; background: #202020; color: #fff; }
</style>
