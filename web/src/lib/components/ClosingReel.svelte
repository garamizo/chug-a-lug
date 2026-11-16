<script lang="ts">
  // Closing Time's reel, full screen: the slides `buildReel` works out from the night, played like a
  // story. The slide list is taken once, when the feed read after Closing Time lands, so a Cheers or a
  // reload arriving mid-play never reshuffles it. Timing is the playhead's (`reelPlayer.ts`), counted
  // on the frame clock: wall time, like any timeout.
  import { onDestroy, onMount, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { pb } from '$lib/pb';
  import { copy, drinkIcons, labels } from '$lib/labels';
  import { fmtDate, fmtTime } from '$lib/time';
  import { liveDay } from '$lib/live/day.svelte';
  import { buildReel, REEL_DURATIONS, stopWindows, type Slide } from '$lib/live/reel';
  import { closingKey, closingSession, closingStore } from '$lib/live/closing';
  import {
    advance, isPaused, nextSlide, pauseReel, prevSlide, progressOf, replayReel, resumeReel, skipSlide, startReel, type ReelState
  } from '$lib/live/reelPlayer';
  import { SPIKE_LABELS } from '$lib/live/spikes';
  import { DRINK_KINDS } from '$lib/live/tab';
  import SpikeArt from './SpikeArt.svelte';

  const HOLD_MS = 250;
  // Images fetched ahead of the slide that shows them, so a failure is skipped before it is reached.
  const PRELOAD_AHEAD = 2;

  let dialog = $state<HTMLDialogElement>();
  let stage = $state<HTMLDivElement>();
  let reel = $state.raw<{ key: string; slides: Slide[]; images: (string | null)[] } | null>(null);
  let play = $state.raw<ReelState | null>(null);
  /** The frame clock, `performance.now()`'s timeline: the progress bar redraws on it. */
  let t = $state(0);
  /** Stop slides whose venue photo failed: the stop still shows, without it. */
  let brokenStops = $state.raw<number[]>([]);

  const slide = $derived(reel && play ? reel.slides[play.index] : null);
  const paused = $derived(!!play && isPaused(play));

  // The snapshot: once, the first time the night's feed is ready. Playback starts with it, and so the
  // phone remembers the reel as shown only now, never when it was merely scheduled.
  $effect(() => {
    if (reel || !liveDay.reelReady) return;
    const closedAt = liveDay.closedAt, scope = liveDay.closingScope, route = liveDay.itinerary;
    if (!closedAt || !scope || !route) return;
    untrack(() => {
      const feed = liveDay.feed;
      const windows = stopWindows(liveDay.stops, liveDay.legs, liveDay.startAt, liveDay.now.getTime() - liveDay.realNow.getTime(), closedAt);
      const slides = buildReel({
        itineraryTitle: route.title, eventDate: route.event_date, stops: liveDay.stops, windows,
        drinks: feed.drinks, media: feed.media, messages: feed.messages, reactions: feed.reactions,
        spikes: liveDay.spikeEvents, date: liveDay.today, closedAt
      });
      const media = new Map(feed.media.map((m) => [m.id, m]));
      const images = slides.map((s) => {
        if (s.kind === 'stop') return s.photo;
        const m = s.kind === 'photo' ? media.get(s.mediaId) : undefined;
        return m ? pb.files.getURL(m, m.file, { thumb: '1200x0' }) : null;
      });
      const key = closingKey(scope);
      reel = { key, slides, images };
      play = startReel(slides.map((s) => REEL_DURATIONS[s.kind]), performance.now());
      closingStore().add(key);
    });
  });

  function fail(index: number) {
    if (!reel || !play) return;
    if (reel.slides[index]?.kind === 'stop') { if (!brokenStops.includes(index)) brokenStops = [...brokenStops, index]; return; }
    play = skipSlide(play, index, performance.now());
  }

  // Preloading: the next few photos, each fetched once. A photo that cannot load is dropped before its turn.
  const preloaded = new Set<number>();
  $effect(() => {
    if (!reel || !play) return;
    const { slides, images } = reel;
    for (let i = play.index; i < Math.min(slides.length, play.index + PRELOAD_AHEAD + 1); i++) {
      const url = images[i];
      if (!url || preloaded.has(i) || slides[i].kind !== 'photo') continue;
      preloaded.add(i);
      const img = new Image();
      img.onerror = () => fail(i);
      img.src = url;
    }
  });

  // Leaving: back to Live when Live is what opened the reel in this session, else replace this entry
  // with Live (a direct entry or a reload has nothing of ours behind it). Once: a double tap pops once.
  let cameFromLive = false;
  let leaving = false;
  afterNavigate(({ from, type }) => { cameFromLive = type !== 'enter' && from?.url.pathname === '/live'; });
  // Any way out (Back included) counts as leaving, so the dialog's close on the way out cannot pop a second entry.
  beforeNavigate(() => { leaving = true; });
  function leave() {
    if (leaving) return;
    leaving = true;
    if (cameFromLive) history.back();
    else void goto('/live', { replaceState: true });
  }

  let opener: Element | null = null;
  onMount(() => {
    opener = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    let frame = requestAnimationFrame(function tick(now) {
      t = now;
      if (play) { const next = advance(play, now); if (next !== play) play = next; }
      frame = requestAnimationFrame(tick);
    });
    // ← and → step, Space pauses; Escape is the dialog's own cancel. A focused button keeps its Space.
    const onkey = (e: KeyboardEvent) => {
      if (!play) return;
      const now = performance.now();
      if (e.key === 'ArrowRight') { e.preventDefault(); play = nextSlide(play, now); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); play = prevSlide(play, now); }
      else if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, a'))) {
        e.preventDefault();
        play = isPaused(play) ? resumeReel(play, now) : pauseReel(play, now);
      }
    };
    window.addEventListener('keydown', onkey);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', onkey); };
  });

  onDestroy(() => {
    leaving = true;
    clearTimeout(press?.timer);
    // Left before it played (✕, or Back while it was still loading): not shown, but not to be opened
    // again by itself this session either.
    const scope = liveDay.closingScope;
    if (!reel && liveDay.closedAt !== null && scope) closingSession.left.add(closingKey(scope));
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  });

  // Taps: the left third goes back, the right third on; a press held past HOLD_MS pauses until it lifts.
  let press: { x: number; width: number; timer: ReturnType<typeof setTimeout>; held: boolean } | null = null;
  function down(e: PointerEvent) {
    if (!play || !stage || e.button > 0) return;
    const r = stage.getBoundingClientRect();
    const p = { x: e.clientX - r.left, width: r.width, held: false, timer: setTimeout(() => {
      if (press !== p || !play || isPaused(play) || play.done) return;
      p.held = true;
      play = pauseReel(play, performance.now());
    }, HOLD_MS) };
    press = p;
  }
  function up() {
    const p = press;
    press = null;
    if (!p || !play) return;
    clearTimeout(p.timer);
    const now = performance.now();
    if (p.held) play = resumeReel(play, now);
    else if (p.x < p.width / 3) play = prevSlide(play, now);
    else if (p.x > (p.width * 2) / 3) play = nextSlide(play, now);
  }
  function cancel() {
    const p = press;
    press = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.held && play) play = resumeReel(play, performance.now());
  }

  const drinkName = (k: string) => (copy as Record<string, string>)[`drink_${k}`] ?? k;
</script>

<!-- svelte-ignore a11y_autofocus -->
<dialog bind:this={dialog} class="reel" class:paused aria-modal="true" aria-label={labels.wrapUpPhase} data-testid="closing-reel"
  tabindex="-1" autofocus
  oncancel={(e) => { e.preventDefault(); leave(); }}
  onclose={leave}>
  {#if reel && play && slide}
    <div class="progress" data-testid="reel-progress" aria-hidden="true">
      {#each reel.slides as _, i (i)}
        {#if !play.skipped.includes(i)}
          <span class="bar"><span class="fill" style:width="{(play.done || i < play.index ? 1 : i === play.index ? progressOf(play, t) : 0) * 100}%"></span></span>
        {/if}
      {/each}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stage" bind:this={stage}
      onpointerdown={down} onpointerup={up} onpointercancel={cancel} onpointerleave={cancel}
      oncontextmenu={(e) => e.preventDefault()}>
      {#key play.index}
        {@const i = play.index}
        {@const s = slide}
        <div class="slide kind-{s.kind}" data-testid="reel-slide-{s.kind}" in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}
          style:--slide-ms="{REEL_DURATIONS[s.kind]}ms">
          {#if s.kind === 'title'}
            <p class="eyebrow">{labels.wrapUpPhase}</p>
            <h2 class="big">{s.title}</h2>
            <p class="sub">{fmtDate(s.date)}</p>
          {:else if s.kind === 'stop'}
            {#if reel.images[i] && !brokenStops.includes(i)}
              <img class="backdrop drift" src={reel.images[i]} alt="" onerror={() => fail(i)} />
            {/if}
            <div class="over">
              {#if s.at}<p class="eyebrow">{fmtTime(s.at)}</p>{/if}
              <h2 class="big">{s.name}</h2>
              <p class="sub">{s.station}</p>
            </div>
          {:else if s.kind === 'photo'}
            {#if reel.images[i]}<img class="photo drift" src={reel.images[i]} alt={s.caption} onerror={() => fail(i)} />{/if}
            <div class="caption">
              <span>{s.caption}</span>
              {#if s.cheers}<span class="cheers">{s.cheers} {copy.closingCheers}</span>{/if}
            </div>
          {:else if s.kind === 'message'}
            <blockquote class="quote">{s.body}</blockquote>
            <p class="sub">{s.author}{#if s.cheers} · <span class="cheers">{s.cheers} {copy.closingCheers}</span>{/if}</p>
          {:else if s.kind === 'spikes'}
            <span class="art"><SpikeArt /></span>
            <p class="eyebrow">{copy.spikeLaurel}</p>
            <ul class="list">
              {#each s.events as e (e.id)}<li><b>{SPIKE_LABELS[e.kind].name}</b> · {e.name}</li>{/each}
            </ul>
          {:else if s.kind === 'drinks'}
            <ul class="drinks">
              {#each DRINK_KINDS.filter((k) => s.counts[k] > 0) as k (k)}
                <li><span class="icon" aria-hidden="true">{drinkIcons[k]}</span><b>{s.counts[k]}</b> {drinkName(k)}</li>
              {/each}
            </ul>
          {:else if s.kind === 'finale'}
            <h2 class="big">{copy.closingFinale}</h2>
            <p class="total"><b>{s.total}</b> {copy.closingCrewTotal}</p>
            {#if s.holders.length || s.caboose.length}
              <span class="art small"><SpikeArt /></span>
              <ul class="list">
                {#each [...s.holders, ...s.caboose] as e (e.id)}<li><b>{SPIKE_LABELS[e.kind].name}</b> · {e.name}</li>{/each}
              </ul>
            {/if}
          {/if}
        </div>
      {/key}
    </div>
    {#if slide.kind === 'finale'}
      <div class="end">
        <button type="button" class="secondary" data-testid="reel-replay" onclick={() => { if (play) play = replayReel(play, performance.now()); }}>{copy.closingReplay}</button>
        <button type="button" data-testid="reel-done" onclick={leave}>{copy.closingDone}</button>
      </div>
    {/if}
  {:else}
    <div class="wait">
      {#if liveDay.closedAt === null}
        <p data-testid="reel-not-yet">{copy.closingNotYet}</p>
        <a href="/live">{copy.backToLive}</a>
      {:else if liveDay.feedError}
        <p role="alert">{copy.noSignal}</p>
        <button type="button" data-testid="reel-retry" onclick={() => void liveDay.loadFeed()}>{copy.closingRetry}</button>
      {:else}
        <p data-testid="reel-loading" role="status">{copy.closingLoading}</p>
      {/if}
    </div>
  {/if}
  <button type="button" class="close" aria-label={copy.closeViewer} data-testid="reel-close" onclick={leave}>✕</button>
</dialog>

<style>
  .reel { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0;
    background: #000; color: #fff; overflow: hidden; outline: none; }
  .reel::backdrop { background: #000; }
  .close { position: absolute; top: max(16px, env(safe-area-inset-top)); right: 12px; z-index: 3; width: 48px; height: 48px;
    margin: 0; padding: 0; border-radius: 50%; background: rgba(0, 0, 0, .6); color: #fff; border: 1px solid #555; }
  .progress { position: absolute; top: max(6px, env(safe-area-inset-top)); left: 12px; right: 12px; z-index: 2; display: flex; gap: 4px; }
  .bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, .3); overflow: hidden; }
  .fill { display: block; height: 100%; background: #fff; }
  .stage { position: absolute; inset: 0; touch-action: manipulation; user-select: none; -webkit-user-select: none;
    -webkit-touch-callout: none; cursor: pointer; }
  .slide { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 72px 24px 112px; text-align: center; overflow: hidden; }
  .eyebrow { margin: 0; font-size: .85rem; letter-spacing: .14em; text-transform: uppercase; color: #f2c94c; }
  .big { margin: 0; font-size: clamp(1.8rem, 9vw, 3rem); line-height: 1.1; overflow-wrap: anywhere; }
  .sub { margin: 0; color: #ccc; font-size: 1.1rem; }
  .backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .45; }
  .over { position: relative; display: flex; flex-direction: column; gap: 8px; }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .caption { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 12px;
    padding: 48px 16px max(24px, env(safe-area-inset-bottom)); background: linear-gradient(transparent, rgba(0, 0, 0, .8)); }
  .cheers { color: #f2c94c; font-weight: 700; }
  .quote { margin: 0; font-size: clamp(1.4rem, 7vw, 2.2rem); line-height: 1.25; overflow-wrap: anywhere; }
  .quote::before { content: '“'; } .quote::after { content: '”'; }
  .art { display: block; width: 96px; height: 96px; }
  .art.small { width: 56px; height: 56px; }
  .list, .drinks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 1.15rem; }
  .drinks { font-size: 1.5rem; }
  .drinks .icon { margin-right: 8px; }
  .drinks b, .total b { color: #f2c94c; }
  .total { margin: 0; font-size: 1.3rem; }
  .end { position: absolute; left: 16px; right: 16px; bottom: max(24px, env(safe-area-inset-bottom)); z-index: 2; display: flex; gap: 12px; }
  .end button { flex: 1; margin: 0; }
  .wait { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    padding: 72px 24px; text-align: center; }
  .wait p { margin: 0; }
  .wait a { display: inline-block; padding: 12px 16px; color: #f2c94c; }
  /* Photos drift slowly while they show and hold still while the reel is paused. */
  .drift { animation: drift var(--slide-ms) linear both; }
  .paused .drift { animation-play-state: paused; }
  @keyframes drift { from { transform: scale(1) translate(0, 0); } to { transform: scale(1.12) translate(-2%, -2%); } }
  @media (prefers-reduced-motion: reduce) { .drift { animation: none; } }
</style>
