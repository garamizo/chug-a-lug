<script lang="ts">
  import { copy } from '$lib/labels';
  import type { Line, Station } from '$lib/types';

  let { lines, selected, onpick }: { lines: Line[]; selected?: string; onpick: (station: Station) => void } = $props();

  const GAP = 72, ROW = 96, PAD = 28, LABEL = 70;
  const width = $derived(PAD * 2 + GAP * Math.max(0, ...lines.map((l) => l.stations.length - 1)));
  const height = $derived(ROW * lines.length + LABEL);
  const y = (i: number) => PAD + i * ROW;
  const x = (j: number) => PAD + j * GAP;

  function onkey(event: KeyboardEvent, station: Station) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onpick(station); }
  }
  function fromSelect(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    const station = lines.flatMap((l) => l.stations).find((s) => s.id === id);
    if (station) onpick(station);
  }
</script>

<div class="scroll">
  <svg {width} {height} viewBox="0 0 {width} {height}" role="group" aria-label={copy.pickStation}>
    {#each lines as line, i}
      <line x1={x(0)} y1={y(i)} x2={x(line.stations.length - 1)} y2={y(i)} stroke={line.color} stroke-width="6" stroke-linecap="round" />
      <text x={x(0)} y={y(i) - 16} fill={line.color} font-size="13" font-weight="700">{line.routeId}</text>
      {#each line.stations as station, j}
        <g role="button" tabindex="0" data-testid="station-{station.id}" aria-label={station.name} aria-pressed={selected === station.id}
           onclick={() => onpick(station)} onkeydown={(e) => onkey(e, station)} style="cursor: pointer">
          <circle cx={x(j)} cy={y(i)} r="16" fill="transparent" />
          <circle cx={x(j)} cy={y(i)} r={selected === station.id ? 10 : 7} fill={selected === station.id ? line.color : '#111'} stroke={line.color} stroke-width="3" />
          <text x={x(j) + 6} y={y(i) + 22} transform="rotate(35 {x(j) + 6} {y(i) + 22})" fill={selected === station.id ? '#fff' : '#bbb'} font-size="11">{station.name}</text>
        </g>
      {/each}
    {/each}
  </svg>
</div>
<label for="station-select">{copy.stationList}</label>
<select id="station-select" data-testid="station-select" value={selected ?? ''} onchange={fromSelect}>
  <option value="" disabled>{copy.pickStation}</option>
  {#each lines as line}
    <optgroup label={line.routeId}>
      {#each line.stations as station}<option value={station.id}>{station.name}</option>{/each}
    </optgroup>
  {/each}
</select>

<style>
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid #333; border-radius: 10px; background: #161616; }
  svg { display: block; }
  g:focus-visible { outline: 2px solid #fff; }
  select { font: inherit; font-size: 18px; padding: 14px; width: 100%; margin-top: 8px; border-radius: 10px; border: 1px solid #666; background: #202020; color: #fff; }
</style>
