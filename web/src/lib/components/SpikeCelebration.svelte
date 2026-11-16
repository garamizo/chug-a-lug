<script lang="ts">
  // The winner's own Golden Spike, celebrated once on their phone. Every decision is the queue's
  // (`celebrate.ts`); this only shows its head for a moment. The card takes its own tap (and only
  // that tap) to dismiss it; the glow around it lets taps through, so the page underneath keeps
  // working, and Escape closes the card without also closing the Tab.
  import { onDestroy, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';
  import { SPIKE_LABELS, type SpikeEvent } from '$lib/live/spikes';
  import { CelebrationQueue, celebrationStore, type CelebrationScope } from '$lib/live/celebrate';
  import { ui } from '$lib/ui.svelte';
  import SpikeArt from './SpikeArt.svelte';

  let { scope, quiet }: { scope: CelebrationScope | null; quiet: boolean } = $props();

  const SHOW_MS = 2500;
  // Activity rows carry the server's stamp, so the 10-minute window is measured on the server's clock.
  const queue = new CelebrationQueue({ now: () => liveDay.serverNow, store: celebrationStore() });
  let showing = $state.raw<SpikeEvent | null>(null);
  // What the card says: kept after it hides so the fade-out still has something to render.
  let last = $state.raw<SpikeEvent | null>(null);
  let turn = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Hidden without `dismiss` (quiet, a presentation, a scope change): not marked, so it comes back.
  function hide() {
    clearTimeout(timer);
    timer = undefined;
    showing = null;
    ui.celebrating = false;
  }
  /** Played its full time, or the user dismissed it: the queue marks it as seen. */
  function dismiss() {
    if (!showing) return;
    queue.done();
    hide();
    turn++;
  }

  // Re-run on the timeline, the scope, quiet and the clock (the window); nothing else.
  $effect(() => {
    void turn;
    const head = queue.next(liveDay.spikeEvents, scope, quiet);
    const at = scope;
    untrack(() => {
      if (head === showing) return;
      hide();
      if (!head || !at) return;
      queue.shown(head, at);
      showing = last = head;
      ui.celebrating = true;
      timer = setTimeout(dismiss, SHOW_MS);
    });
  });

  // Escape is the card's while it shows: first in line, and no one else (the Tab sheet) hears it.
  $effect(() => {
    if (!showing) return;
    const onkey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      dismiss();
    };
    window.addEventListener('keydown', onkey, { capture: true });
    return () => window.removeEventListener('keydown', onkey, { capture: true });
  });

  onDestroy(() => { clearTimeout(timer); queue.reset(); ui.celebrating = false; });
</script>

<!-- The live region is always there, so a screen reader hears the card when it fills in. -->
<div role="status" aria-live="polite">
  {#if showing && last}
    {@const label = SPIKE_LABELS[last.kind]}
    <div class="layer" data-testid="spike-celebration" transition:fade={{ duration: 250 }}>
      <button type="button" class="card" data-testid="spike-card"
        onclick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(); }}>
        <span class="spike"><SpikeArt /></span>
        <span class="eyebrow">{copy.spikeAuthor}</span>
        <span class="name">{label.name}</span>
        <span class="why">{label.why}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  /* The glow lets taps through; only the card, high on the screen and clear of the Tab sheet, takes them. */
  .layer { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: flex; justify-content: center;
    align-items: flex-start; padding: max(96px, 14vh) 16px 16px;
    background: radial-gradient(circle at 50% 26%, rgba(242, 201, 76, .35), rgba(17, 17, 17, .45) 60%); }
  .card { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; width: auto;
    max-width: min(320px, 100%); margin: 0; padding: 18px 28px; border-radius: 16px; background: rgba(27, 27, 27, .94);
    color: #ddd; font-weight: 400; border: 1px solid #f2c94c; box-shadow: 0 0 40px rgba(242, 201, 76, .45);
    animation: pop .55s cubic-bezier(.2, 1.4, .4, 1) both; }
  .spike { display: block; width: 72px; height: 72px; animation: drive .55s .15s cubic-bezier(.3, 1.6, .5, 1) both; }
  .eyebrow { font-size: .8rem; letter-spacing: .12em; text-transform: uppercase; color: #f2c94c; }
  .name { font-size: 1.8rem; font-weight: 800; color: #fff2b0; }
  .why { font-size: 1rem; }
  @keyframes pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
  @keyframes drive { from { transform: translateY(-24px) rotate(-12deg); } to { transform: none; } }
  @keyframes appear { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .card { animation: appear .3s both; }
    .spike { animation: none; }
  }
</style>
