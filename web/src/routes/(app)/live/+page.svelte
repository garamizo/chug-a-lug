<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  // The shared `liveDay` owns the data; the Tab is the app layout's (`TabHost`), over every screen.
  import { clientClock } from '$lib/sim/clock.svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { copy } from '$lib/labels';
  import { mirrorSavedWhen } from '$lib/offline';
  import { auth, pb } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import { compressForUpload, uploadBatch } from '$lib/live/upload';
  import { openStop, sheetStopId } from '$lib/nav';
  import { closingKey, closingSession, closingStore, eventfulReel, leftThisSession, shouldAutoOpen } from '$lib/live/closing';
  import { stripStops } from '$lib/live/strip';
  import CrewChat from '$lib/components/CrewChat.svelte';
  import StopSheet from '$lib/components/StopSheet.svelte';
  import RouteStrip from '$lib/components/RouteStrip.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import { ui } from '$lib/ui.svelte';
  import { onMount, tick } from 'svelte';
  import FreightStrip from '$lib/components/FreightStrip.svelte';

  // Upload trouble shows in the chat box that sent the photos, not up by the Tab.
  let uploadError = $state('');
  let uploading = $state(false);
  const here = $derived(liveDay.here);
  // The board retains a stop before and after the crawl, when the Tab and Freight must stay closed.
  const tabStop = $derived(liveDay.tabStop);
  const strip = $derived(stripStops(liveDay.stops, liveDay.legs, here, liveDay.startAt));

  // Closing Time: once the train home has arrived, a card plays the night's reel, and the first time this
  // phone is on Live with the whole night's feed in, the reel opens by itself if the night has anything in
  // it. Not again once it has played here, not again this session once someone left it unplayed, and
  // never while Live is `busy`: leaving Live unmounts it, so nothing may be open over it or still unsent
  // in it, and a Golden Spike card on screen (Caboose arrives at Closing Time itself) plays out first.
  const closings = closingStore();
  let playButton = $state<HTMLButtonElement>();
  let autoOpening = false;
  /** The chat box holds a draft, an open picker or a message in flight. */
  let chatUnsaved = $state(false);
  /** A text field has the focus: someone is typing, whatever the box holds. */
  let typing = $state(false);
  const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
  const isTextField = (el: EventTarget | Element | null) => el instanceof HTMLTextAreaElement
    || (el instanceof HTMLInputElement && !NOT_TEXT.has(el.type)) || (el instanceof HTMLElement && el.isContentEditable);
  const trackFocus = (e: FocusEvent) => { typing = isTextField(e.type === 'focusin' ? e.target : e.relatedTarget); };
  onMount(() => { typing = isTextField(document.activeElement); });
  const busy = $derived(!!sheetStopId() || !!page.state.lightbox || ui.tabOpen || ui.tabBusy || liveDay.composing || ui.menuOpen || ui.celebrating
    || typing || chatUnsaved || uploading);
  function autoOpen(): boolean {
    const scope = liveDay.closingScope;
    if (!scope) return false;
    const key = closingKey(scope);
    // Live is never quiet: practice interrupts only the screen that is practising, and this is that screen.
    const now = { ready: liveDay.reelReady, shown: closings.has(key), busy, quiet: false,
      leftThisSession: leftThisSession(closingSession, key, liveDay.closedAt !== null) };
    // The reel is worked out only once everything else says go.
    return shouldAutoOpen({ ...now, eventful: true }) && shouldAutoOpen({ ...now, eventful: eventfulReel(liveDay.closingReel() ?? []) });
  }
  $effect(() => {
    // Asked before the guard, so every input is tracked and any of them changing asks again.
    if (!autoOpen() || autoOpening) return;
    autoOpening = true;
    // Once this update has settled (a celebration card starting in it, say), ask once more before leaving.
    void tick().then(() => (autoOpen() ? goto('/live/closing') : undefined)).finally(() => { autoOpening = false; });
  });
  // Back from the reel: Play takes the focus the reel had.
  afterNavigate((nav) => {
    if (nav.from?.url?.pathname === '/live/closing') void tick().then(() => playButton?.focus());
  });

  // Photos go to the chat at any time. While a stop is open they are also filed under it (its strip
  // and first-photo milestone); before and after the crawl the server files them under the route.
  async function upload(selected: File[]) {
    const stop = tabStop, user = $auth.user;
    if (!selected.length || !user || uploading) return;
    uploadError = '';
    uploading = true;
    try {
      await clientClock.ready();
      liveDay.syncNow();
      if (stop && tabStop?.id !== stop.id) throw new Error(copy.simClockConflict);
      uploadError = await uploadBatch(selected, async (file) => {
        const prepared = await compressForUpload(file);
        const form = new FormData();
        form.set('user', user.id);
        if (stop) form.set('stop', stop.id);
        form.set('kind', prepared.kind);
        form.set('taken_at', prepared.takenAt);
        form.set('file', prepared.file);
        await clientClock.ready();
        await pb.collection('media').create(form);
      }, () => liveDay.loadFeed());
    } catch { uploadError = copy.noSignal; } finally { uploading = false; }
  }
</script>

<svelte:head><title>{copy.live}</title></svelte:head>
<svelte:document onfocusin={trackFocus} onfocusout={trackFocus} />

{#if liveDay.fromMirror && liveDay.mirrorSavedAt}
  <p class="stale" data-testid="mirror-notice">{copy.showingMirror} {mirrorSavedWhen(liveDay.mirrorSavedAt, liveDay.wallNow)}.</p>
{/if}

{#if liveDay.closedAt}
  <section class="closing" data-testid="closing-card">
    <p>{copy.closingCard}</p>
    <button type="button" bind:this={playButton} data-testid="closing-play" onclick={() => void goto('/live/closing')}>{copy.closingPlay}</button>
  </section>
{/if}

{#if !liveDay.hasRoute}
  <p data-testid="no-active-route">{copy.noActiveRoute} <a href="/plan">{copy.backToPlanner}</a></p>
{:else if here?.stop}
  <AlertBubbles alerts={liveDay.alerts} onopen={() => goto('/notifications')} />
  {@const b = liveDay.boarding}
  {@const h = liveDay.rideHome}
  <DepartureBoard
    station={b ? b.fromName : here.stop.station_name || here.stop.station_id}
    stopName={here.stop.name}
    nextStation={b ? b.toName : h ? h.toName : here.onwardStop?.station_name || here.onwardStop?.station_id || ''}
    trip={liveDay.trip}
    walkMin={b ? b.walkMin : here.stop.walk_min}
    now={liveDay.now}
    mode={liveDay.mode}
    rtFetchedAt={liveDay.rtFetchedAt}
    ridingHome={h?.riding ? { arriveAt: h.arriveAt, toName: h.toName } : undefined} />
  <RouteStrip items={strip} onopen={openStop} />
{/if}
{#if liveDay.practice}<p class="practice-banner" data-testid="practice-badge" title={copy.practiceHint}>{copy.practiceBadge}</p>{/if}
<!-- Bulletins are the Conductor's alone, so the crew never sees the button. -->
{#if $auth.user?.is_admin}
  <div class="actions">
    <button class="action speaker" data-testid="action-bulletin" disabled={!liveDay.itinerary} title={copy.tellTheCrew} onclick={() => liveDay.composing = true}><span aria-hidden="true">📣</span>{copy.bulletinAction}</button>
  </div>
{/if}
{#if tabStop && liveDay.media.length}<FreightStrip media={liveDay.media} />{/if}

{#if liveDay.itinerary && $auth.user}<CrewChat itineraryId={liveDay.itinerary.id} userId={$auth.user.id}
  onfiles={(files) => upload(files)} onunsaved={(u) => (chatUnsaved = u)} {uploading} {uploadError} />{/if}

{#if liveDay.itinerary}
  <StopSheet stops={liveDay.stops} media={liveDay.feed.media} eventDate={liveDay.itinerary.event_date}
    itineraryId={liveDay.itinerary.id} isAdmin={!!$auth.user?.is_admin} />
{/if}

<style>
  /* A flat strip pinned to the foot of the screen, just above the TabBar. */
  .practice-banner { position: fixed; left: 0; right: 0; bottom: 0; z-index: 15; margin: 0; padding: 4px 0 calc(4px + env(safe-area-inset-bottom));
    background: #1d3440; color: #bfe3f2; text-align: center; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; line-height: 1.4; }
  :global(body:has(.practice-banner)) { padding-bottom: calc(24px + env(safe-area-inset-bottom)); }
  :global(body:has(.tabbar)) .practice-banner { bottom: calc(64px + env(safe-area-inset-bottom)); padding-bottom: 4px; }
  :global(body:has(.tabbar):has(.practice-banner)) { padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
  .actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 0 0 14px; align-items: start; }
  .action { display: flex; width: 100%; margin: 0; flex-direction: row; align-items: center; justify-content: center; gap: 8px; border-radius: 16px; padding: 8px 5px; border: 1px solid #b5873b; color: #ffe3a3; background: linear-gradient(145deg, #443319, #211b13); box-shadow: 0 3px 0 #695024; font-size: 13px; }
  .action span { font-size: 22px; line-height: 1.2; }
  .action:active { transform: translateY(2px); box-shadow: none; }
  .speaker { background: linear-gradient(145deg, #403050, #241d2d); border-color: #886a9b; box-shadow: 0 3px 0 #574363; color: #efdcff; }
  .action:disabled { opacity: .45; box-shadow: none; }
  .closing { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 0; padding: 12px 12px 12px 16px;
    border: 1px solid #b5873b; border-radius: 16px; background: linear-gradient(145deg, #443319, #211b13); color: #ffe3a3; }
  .closing p { margin: 0; font-weight: 700; }
  .closing button { width: auto; flex: none; margin: 0; padding: 8px 18px; border-radius: 999px; background: #f2c94c; color: #111; font-weight: 700; }
  .stale { margin: 12px 0; padding: 10px 12px; border: 1px solid #555; border-radius: 9px; font-size: 13px; color: #cfcfcf; }
</style>
