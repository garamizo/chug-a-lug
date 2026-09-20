<script lang="ts">
  // One line drawn top to bottom through the middle of the screen, with a row per station. The
  // caller fills the cells left and right of the line (stop cards, station buttons, labels).
  //
  // In `panes` mode each side is wider than half the screen and the map sits in a horizontally
  // snapping viewport: one side is in focus, the line stays in view, and about a fifth of the
  // other side peeks in. Dragging, the focusSide() method, or focusing something on the other
  // side shifts it.
  import type { Snippet } from 'svelte';
  import type { Station } from '$lib/types';
  import type { Side } from '$lib/lineMap';

  let { stations, color = '#29C233', selected, panes = false, onpick, pickLabel, onside, left, right }: {
    stations: Station[]; color?: string; selected?: string; panes?: boolean;
    /** When set, each station's circle is a button. */
    onpick?: (station: Station) => void; pickLabel?: (station: Station) => string;
    onside?: (side: Side) => void;
    left?: Snippet<[Station, number]>; right?: Snippet<[Station, number]>;
  } = $props();

  let viewport: HTMLDivElement | undefined = $state();
  let side: Side = 'left';

  export function focusSide(next: Side) {
    if (!viewport) return;
    viewport.scrollTo({ left: next === 'left' ? 0 : viewport.scrollWidth, behavior: 'smooth' });
  }
  // Focusing (or tapping) anything on the other side brings that side in.
  function onfocusin(event: FocusEvent) {
    if (!panes) return;
    const cell = (event.target as HTMLElement).closest('.cell');
    if (cell) focusSide(cell.classList.contains('left') ? 'left' : 'right');
  }
  function onscroll() {
    if (!viewport) return;
    const next: Side = viewport.scrollLeft < (viewport.scrollWidth - viewport.clientWidth) / 2 ? 'left' : 'right';
    if (next !== side) { side = next; onside?.(next); }
  }
</script>

<div class="viewport" class:panes bind:this={viewport} {onscroll} {onfocusin}>
  <div class="map" style:--line={color} role="list">
    {#each stations as station, i (station.id)}
      <div class="row" role="listitem" data-testid="map-row-{station.id}" data-served={station.served === false ? 'false' : 'true'}>
        <div class="cell left">{@render left?.(station, i)}</div>
        <div class="track" class:first={i === 0} class:last={i === stations.length - 1}>
          {#if station.served === false}
            <span class="dot off" aria-hidden="true"></span>
          {:else if onpick}
            <button type="button" class="pick" data-testid="station-dot-{station.id}" aria-label={pickLabel?.(station) ?? station.name}
              aria-pressed={selected === station.id} onclick={() => onpick(station)}><span class="dot plus" class:on={selected === station.id} aria-hidden="true"></span></button>
          {:else}
            <span class="dot" class:on={selected === station.id} aria-hidden="true"></span>
          {/if}
        </div>
        <div class="cell right">{@render right?.(station, i)}</div>
      </div>
    {/each}
  </div>
</div>

<style>
  .viewport { --track: 36px; --dot-y: 24px; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) var(--track) minmax(0, 1fr); column-gap: 8px; min-height: 48px; }
  .track { position: relative; }
  .track::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 12px; margin-left: -6px; background: var(--line); }
  .track.first::before { top: var(--dot-y); border-radius: 6px 6px 0 0; }
  .track.last::before { bottom: auto; height: var(--dot-y); border-radius: 0 0 6px 6px; }
  .dot { position: absolute; left: 50%; top: calc(var(--dot-y) - 8px); width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; background: #fff; border: 3px solid var(--line); box-sizing: border-box; }
  /* No train stops here on the crawl date: greyed out and, in pick mode, not a button. */
  .dot.off { background: #2a2a2a; border-color: #666; }
  .dot.on { width: 22px; height: 22px; margin-left: -11px; top: calc(var(--dot-y) - 11px); background: var(--line); border-color: #fff; }
  .pick { position: absolute; left: 50%; top: calc(var(--dot-y) - 24px); width: 48px; height: 48px; margin: 0 0 0 -24px; padding: 0; background: transparent; border: 0; border-radius: 50%; cursor: pointer; }
  .pick .dot { width: 22px; height: 22px; top: 13px; margin-left: -11px; }
  .pick .dot.on { width: 26px; height: 26px; top: 11px; margin-left: -13px; }
  /* A plus inside the circle says "tap to add here". */
  .plus::before, .plus::after { content: ''; position: absolute; left: 50%; top: 50%; background: var(--line); transform: translate(-50%, -50%); }
  .plus::before { width: 10px; height: 2px; }
  .plus::after { width: 2px; height: 10px; }
  .plus.on::before, .plus.on::after { background: #fff; }
  .pick:hover .dot { background: #ffe9b3; }
  .cell { min-width: 0; padding-bottom: 8px; }
  .left { text-align: right; }

  /* Two panes: each side is (viewport - track) / 1.2 wide, so the focused side, the line and a
     fifth of the other side fill the viewport exactly. */
  .panes { overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .panes::-webkit-scrollbar { display: none; }
  .panes .map { width: calc((100% - var(--track)) / 0.6 + var(--track)); }
  .panes .row { column-gap: 0; }
  .panes .cell { padding: 0 8px 8px; }
  .panes .left { scroll-snap-align: start; }
  .panes .right { scroll-snap-align: end; }
</style>
