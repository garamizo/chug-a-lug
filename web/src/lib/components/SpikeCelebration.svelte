<script lang="ts">
  // The winner's own Golden Spike, celebrated once on their phone. Every decision is the queue's
  // (`celebrate.ts`); this only shows its head for a moment. It never takes a tap from the page:
  // the layer lets pointers through, and any tap or key dismisses it on the way past.
  import { onDestroy, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';
  import { spikes, SPIKE_LABELS, type SpikeEvent } from '$lib/live/spikes';
  import { CelebrationQueue, celebrationStore, type CelebrationScope } from '$lib/live/celebrate';

  let { scope, quiet }: { scope: CelebrationScope | null; quiet: boolean } = $props();

  const SHOW_MS = 2500;
  // Activity rows carry the server's stamp, so the 10-minute window is measured on the server's clock.
  const queue = new CelebrationQueue({ now: () => liveDay.serverNow, store: celebrationStore() });
  const events = $derived(spikes(liveDay.spikeInput));
  let showing = $state.raw<SpikeEvent | null>(null);
  let turn = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    timer = undefined;
    showing = null;
  }
  function dismiss() {
    if (!showing) return;
    queue.done();
    hide();
    turn++;
  }

  // Re-run on the timeline, the scope, quiet and the clock (the window); nothing else.
  $effect(() => {
    void turn;
    const head = queue.next(events, scope, quiet);
    const at = scope;
    untrack(() => {
      if (head === showing) return;
      hide();
      if (!head || !at) return;
      queue.shown(head, at);
      showing = head;
      timer = setTimeout(dismiss, SHOW_MS);
    });
  });

  // Capture, never prevent: the tap still reaches whatever it was meant for.
  $effect(() => {
    if (!showing) return;
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', dismiss, opts);
    window.addEventListener('keydown', dismiss, opts);
    return () => {
      window.removeEventListener('pointerdown', dismiss, opts);
      window.removeEventListener('keydown', dismiss, opts);
    };
  });

  onDestroy(() => { clearTimeout(timer); queue.reset(); });
</script>

{#if showing}
  {@const label = SPIKE_LABELS[showing.kind]}
  <div class="layer" data-testid="spike-celebration" role="status" aria-live="polite" transition:fade={{ duration: 250 }}>
    <div class="card">
      <svg class="spike" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="spike-gold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#fff2b0" /><stop offset=".45" stop-color="#f2c94c" /><stop offset="1" stop-color="#a87a12" />
          </linearGradient>
        </defs>
        <rect x="6" y="44" width="52" height="8" rx="2" fill="#5a4a2a" />
        <path d="M22 8h20l-4 6v26l-6 14-6-14V14z" fill="url(#spike-gold)" stroke="#7a5a0c" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <p class="eyebrow">{copy.spikeAuthor}</p>
      <p class="name">{label.name}</p>
      <p class="why">{label.why}</p>
    </div>
  </div>
{/if}

<style>
  .layer { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: grid; place-items: center; padding: 16px;
    background: radial-gradient(circle at 50% 42%, rgba(242, 201, 76, .35), rgba(17, 17, 17, .55) 65%); }
  .card { text-align: center; padding: 20px 28px; border-radius: 16px; background: rgba(27, 27, 27, .92);
    border: 1px solid #f2c94c; box-shadow: 0 0 40px rgba(242, 201, 76, .45); max-width: min(320px, 100%);
    animation: pop .55s cubic-bezier(.2, 1.4, .4, 1) both; }
  .spike { width: 72px; height: 72px; animation: drive .55s .15s cubic-bezier(.3, 1.6, .5, 1) both; }
  .eyebrow { margin: 4px 0 0; font-size: .8rem; letter-spacing: .12em; text-transform: uppercase; color: #f2c94c; }
  .name { margin: 4px 0; font-size: 1.8rem; font-weight: 800; color: #fff2b0; }
  .why { margin: 0; color: #ddd; }
  @keyframes pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
  @keyframes drive { from { transform: translateY(-24px) rotate(-12deg); } to { transform: none; } }
  @keyframes appear { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .card { animation: appear .3s both; }
    .spike { animation: none; }
  }
</style>
