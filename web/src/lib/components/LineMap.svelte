<script lang="ts">
  // One line drawn top to bottom with a row per station. Two layouts:
  //  - `cell`: the circle on the line, one cell to its right (the station picker).
  //  - `left` + `right`: a cell each side of the line (the route: going stops left, return stops right).
  //
  // In `panes` mode each side is nearly the whole viewport wide and the map sits in a horizontally
  // snapping viewport: one side is in focus, the line stays in view, and a narrow strip of the other
  // side peeks in. Dragging, focusSide(), or focusing something on the other side shifts it.
  import type { Snippet } from 'svelte';
  import type { Station } from '$lib/types';
  import type { Side } from '$lib/lineMap';

  let { stations, color = '#29C233', selected, panes = false, onpick, pickLabel, onside, cell, left, right }: {
    stations: Station[]; color?: string; selected?: string; panes?: boolean;
    /** When set, each station's circle is a button. */
    onpick?: (station: Station) => void; pickLabel?: (station: Station) => string;
    /** The side in focus changed (a drag, a tab, a focused card). */
    onside?: (side: Side) => void;
    cell?: Snippet<[Station, number]>; left?: Snippet<[Station, number]>; right?: Snippet<[Station, number]>;
  } = $props();

  const sided = $derived(!!left || !!right);
  let viewport: HTMLDivElement | undefined = $state();
  let side = $state<Side>('left');
  // A scroll this component started: drag detection waits until it lands, so a smooth scroll to the
  // right does not read as "back on the left" halfway there.
  let pending: Side | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const endOf = (el: HTMLElement, s: Side) => (s === 'left' ? 0 : el.scrollWidth - el.clientWidth);
  const scrollable = (el: HTMLElement) => el.scrollWidth > el.clientWidth;
  /** The side the viewport actually shows. Both fit (a wide screen): whatever was chosen stands. */
  const shown = (el: HTMLElement): Side | null => (scrollable(el) ? (el.scrollLeft < (el.scrollWidth - el.clientWidth) / 2 ? 'left' : 'right') : null);

  function settle(next: Side) {
    if (next === side) return;
    side = next;
    onside?.(next);
  }

  /** Brings `next` into focus: reports it at once (it may not scroll at all), then scrolls there. */
  export function focusSide(next: Side, behavior: ScrollBehavior = 'smooth') {
    settle(next);
    const el = viewport;
    if (!el || !scrollable(el) || Math.abs(el.scrollLeft - endOf(el, next)) <= 1) return;
    pending = next;
    clearTimeout(pendingTimer);
    // A smooth scroll something cut short never lands: after a moment, believe the position.
    pendingTimer = setTimeout(() => { pending = null; reconcile(); }, 1000);
    el.scrollTo({ left: endOf(el, next), behavior });
  }

  function reconcile() {
    const s = viewport && shown(viewport);
    if (s) settle(s);
  }
  // A finger or wheel overrides a scroll this component started.
  function userInput() {
    if (pending) { pending = null; clearTimeout(pendingTimer); }
  }

  // A wide screen turned into a phone (rotation, a narrower window): the panes appear with the
  // going side showing, so bring the chosen side back on screen.
  $effect(() => {
    const el = viewport;
    if (!el || !panes) return;
    const ro = new ResizeObserver(() => {
      if (scrollable(el) && !pending && Math.abs(el.scrollLeft - endOf(el, side)) > 1) {
        pending = side;
        el.scrollTo({ left: endOf(el, side), behavior: 'instant' });
        pending = null;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // A tap on the side that only peeks in switches to it; it must not open the card under the finger.
  // The side is read at pointerdown because the tap's focus (focusin below) switches before click.
  let downSide: Side | null = null;
  function onpointerdown() {
    userInput();
    downSide = viewport && scrollable(viewport) ? side : null;
  }
  // These only watch the viewport's input (they are not controls of their own), so they are plain
  // listeners: passive where they never cancel, capture for the click they may swallow.
  $effect(() => {
    const el = viewport;
    if (!el) return;
    el.addEventListener('pointerdown', onpointerdown, { passive: true });
    el.addEventListener('touchstart', userInput, { passive: true });
    el.addEventListener('wheel', userInput, { passive: true });
    el.addEventListener('click', onclickcapture, { capture: true });
    return () => {
      el.removeEventListener('pointerdown', onpointerdown);
      el.removeEventListener('touchstart', userInput);
      el.removeEventListener('wheel', userInput);
      el.removeEventListener('click', onclickcapture, { capture: true });
    };
  });
  function onclickcapture(event: MouseEvent) {
    const was = downSide;
    downSide = null;
    if (!panes || !was) return;
    const c = (event.target as HTMLElement).closest('.cell');
    const cellSide: Side | null = c?.classList.contains('left') ? 'left' : c?.classList.contains('right') ? 'right' : null;
    if (!cellSide || cellSide === was) return;
    event.preventDefault();
    event.stopPropagation();
    focusSide(cellSide);
  }

  // Focusing (or tapping) anything on the other side brings that side in.
  function onfocusin(event: FocusEvent) {
    if (!panes) return;
    const c = (event.target as HTMLElement).closest('.cell');
    if (c && (c.classList.contains('left') || c.classList.contains('right'))) focusSide(c.classList.contains('left') ? 'left' : 'right');
  }
  function onscroll() {
    const el = viewport;
    if (!el) return;
    if (pending) {
      if (Math.abs(el.scrollLeft - endOf(el, pending)) <= 1) { pending = null; clearTimeout(pendingTimer); }
      return;
    }
    reconcile();
  }
</script>

{#snippet track(station: Station, i: number)}
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
{/snippet}

<div class="linemap" style:--line={color}>
  {#if sided}
    <div class="viewport" class:panes bind:this={viewport} {onscroll} {onfocusin} data-testid="line-viewport" data-focused={side}>
      <div class="map sided" role="list">
        {#each stations as station, i (station.id)}
          <div class="row" role="listitem" data-testid="map-row-{station.id}" data-served={station.served === false ? 'false' : 'true'}>
            <div class="cell left">{@render left?.(station, i)}</div>
            {@render track(station, i)}
            <div class="cell right">{@render right?.(station, i)}</div>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="map" role="list">
      {#each stations as station, i (station.id)}
        <div class="row" role="listitem" data-testid="map-row-{station.id}" data-served={station.served === false ? 'false' : 'true'}>
          {@render track(station, i)}
          <div class="cell">{@render cell?.(station, i)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* A size container, so the panes know whether both sides fit (a wide screen) or not (a phone). */
  .linemap { --track: 36px; --peek: 28px; --dot-y: 24px; container-type: inline-size; }
  .row { display: grid; grid-template-columns: var(--track) minmax(0, 1fr); column-gap: 10px; min-height: 48px; }
  .sided .row { grid-template-columns: minmax(0, 1fr) var(--track) minmax(0, 1fr); column-gap: 8px; }
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

  /* Two panes: each side is the viewport less the line and a --peek strip, so the focused side, the
     line near the edge and a sliver of the other side fill the viewport exactly. Only sideways
     overscroll is contained, so a vertical drag or wheel over the line still scrolls the page. */
  .panes { overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .panes::-webkit-scrollbar { display: none; }
  .panes .map { width: calc(200% - var(--track) - 2 * var(--peek)); }
  .panes .row { column-gap: 0; }
  .panes .cell { padding: 0 8px 8px; }
  .panes .cell.left { scroll-snap-align: start; }
  .panes .cell.right { scroll-snap-align: end; }
  /* Room for both sides in full: no panes to drag between. */
  @container (min-width: 640px) {
    .panes { scroll-snap-type: none; }
    .panes .map { width: auto; }
  }
</style>
