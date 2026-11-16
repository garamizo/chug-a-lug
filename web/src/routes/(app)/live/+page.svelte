<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  // The shared `liveDay` owns the data so a Tab tap reaches every screen through the same tally.
  import { ClientResponseError } from 'pocketbase';
  import { SvelteSet } from 'svelte/reactivity';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { goto } from '$app/navigation';
  import { copy, drinkIcons } from '$lib/labels';
  import { mirrorSavedWhen } from '$lib/offline';
  import { auth, pb } from '$lib/pb';
  import type { DrinkEntry, DrinkKind, Media } from '$lib/types';
  import { liveDay } from '$lib/live/day.svelte';
  import { compressForUpload, uploadBatch } from '$lib/live/upload';
  import { openStop } from '$lib/nav';
  import { stripStops } from '$lib/live/strip';
  import { sameScope, sendProof, type ProofScope, type ProofSend } from '$lib/live/proof';
  import { drinkCount } from '$lib/live/crew';
  import { topLine } from '$lib/live/leaderboard';
  import { newRecordId } from '$lib/live/staged';
  import CrewChat from '$lib/components/CrewChat.svelte';
  import StopSheet from '$lib/components/StopSheet.svelte';
  import RouteStrip from '$lib/components/RouteStrip.svelte';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import TabRow from '$lib/components/TabRow.svelte';
  import TabSheet from '$lib/components/TabSheet.svelte';
  import { ui } from '$lib/ui.svelte';
  import { onDestroy } from 'svelte';
  import FreightStrip from '$lib/components/FreightStrip.svelte';
  import Leaderboard from '$lib/components/Leaderboard.svelte';

  let error = $state('');
  // The Tab sheet is Live's: leaving Live closes it.
  onDestroy(() => { ui.tabOpen = false; });
  // Upload trouble shows in the chat box that sent the photos, not up by the Tab.
  let uploadError = $state('');
  let uploading = $state(false);
  const here = $derived(liveDay.here);
  // The board retains a stop before and after the crawl, when the Tab and Freight must stay closed.
  const tabStop = $derived(here?.source === 'clock' || here?.source === 'override' ? here.stop : null);
  const strip = $derived(stripStops(liveDay.stops, liveDay.legs, here, liveDay.startAt));

  // A drink is its photo: a tap sends one, and nothing counts until the server has it. These are
  // the photos still on their way (from the moment one is picked), each under the id its drink gets.
  let sending = $state<{ key: number; kind: DrinkKind }[]>([]);
  let sendKey = 0;
  // The last send that failed, kept (with its photo and id) for Retry while its scope is current.
  let retry = $state<ProofSend | null>(null);
  let clinking = $state<DrinkKind | null>(null);
  // The toast's target stays until its delete succeeds, so a failed Undo can be retried.
  let toast = $state<{ id: string; kind: DrinkKind; failed: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const me = $derived($auth.user?.id ?? '');
  // Who, which route, which server day and which simulation run a send belongs to. A change of any
  // of them makes an unfinished send stale: no Retry, and a late answer is left to the feed's reload.
  const scope = $derived<ProofScope | null>(me && liveDay.itinerary
    ? { user: me, itinerary: liveDay.itinerary.id, day: liveDay.today, runId: clientClock.runId ?? null } : null);
  $effect(() => { if (retry && !sameScope(retry.scope, scope)) retry = null; });
  // Only saved rows count, by the server's day.
  const dayTotal = $derived(drinkCount(liveDay.feed.drinks, me, liveDay.today));
  const leaders = $derived($auth.user ? topLine(liveDay.feed.drinks, { id: $auth.user.id, name: $auth.user.name }, liveDay.today) : []);
  const showToast = (id: string, kind: DrinkKind) => {
    clearTimeout(toastTimer);
    toast = { id, kind, failed: false };
    toastTimer = setTimeout(() => { if (toast?.id === id && !toast.failed) toast = null; }, 4000);
  };

  // The camera answered: shrink the photo, then send it as the drink, at the stop it was taken.
  async function logDrink(kind: DrinkKind, photo: File) {
    const stop = tabStop, at = scope;
    if (!stop || !at) return;
    error = '';
    const key = ++sendKey;
    sending = [...sending, { key, kind }];
    navigator.vibrate?.(30);
    try {
      const prepared = await compressForUpload(photo);
      if (prepared.kind !== 'image') throw new Error(copy.proofNeedsImage);
      await submit({ id: newRecordId(), kind, stop: stop.id, scope: at, file: prepared.file, takenAt: prepared.takenAt });
    } catch (err) {
      // Only a photo the phone could not use lands here; there is nothing to retry.
      if (sameScope(at, scope)) error = err instanceof Error ? err.message : copy.uploadFailed;
    } finally {
      sending = sending.filter((s) => s.key !== key);
    }
  }

  async function submit(send: ProofSend) {
    // A new tap supersedes whatever the toast was showing: hide it now, so Undo can never remove
    // the previous drink while this one is in flight. showToast below retargets it once this
    // photo has landed.
    clearTimeout(toastTimer);
    toast = null;
    let result: Awaited<ReturnType<typeof sendProof>>;
    try {
      await clientClock.ready();
      liveDay.syncNow();
      result = await sendProof(send, {
        createMedia: (form) => pb.collection('media').create<Media>(form, { expand: 'user' }),
        getDrink: (id) => pb.collection('drink_entries').getOne<DrinkEntry>(id, { expand: 'user,stop' }),
        getMedia: (id) => pb.collection('media').getOne<Media>(id, { expand: 'user' }),
        currentScope: () => scope
      });
    } catch (err) {
      // No clock to send by (offline, or the simulation is away): the photo is kept for Retry.
      result = sameScope(send.scope, scope)
        ? { status: 'failed', message: err instanceof Error && err.message ? err.message : copy.noSignal } : { status: 'stale' };
    }
    if (result.status === 'stale') { if (retry?.id === send.id) retry = null; return; }
    if (result.status === 'failed') { error = result.message; retry = send; return; }
    if (retry?.id === send.id) retry = null;
    if (result.drink) liveDay.upsertDrink(result.drink);
    if (result.media) liveDay.upsertMedia(result.media);
    clinking = send.kind;
    setTimeout(() => { if (clinking === send.kind) clinking = null; }, 400);
    showToast(send.id, send.kind);
    void liveDay.loadFeed();
  }

  // Retry sends the same photo under the same id, so a first attempt that did land is counted once.
  async function retrySend() {
    const send = retry;
    retry = null;
    if (!send || !sameScope(send.scope, scope)) return;
    error = '';
    const key = ++sendKey;
    sending = [...sending, { key, kind: send.kind }];
    try { await submit(send); } finally { sending = sending.filter((s) => s.key !== key); }
  }

  // Mirrors CrewChat's reaction guard: a target already being undone ignores a repeat tap outright,
  // and a 404 on delete means another tab already undid it — the reload below shows the true state.
  const undoing = new SvelteSet<string>();

  async function undoDrink(target: { id: string; kind: DrinkKind }) {
    if (undoing.has(target.id)) return;
    undoing.add(target.id);
    error = '';
    clearTimeout(toastTimer);
    if (toast?.id === target.id) toast = { ...toast, failed: false };
    try {
      await clientClock.ready();
      try { await pb.collection('drink_entries').delete(target.id); }
      catch (err) { if (!(err instanceof ClientResponseError && err.status === 404)) throw err; }
      liveDay.dropDrink(target.id);
      liveDay.dropMedia(target.id);   // a proof's photo goes with its drink (same id)
      if (toast?.id === target.id) toast = null;
      void liveDay.loadFeed();
    } catch {
      error = copy.noSignal;
      // Keep the button: the entry is still saved and the person still wants it gone.
      if (toast?.id === target.id) toast = { ...toast, failed: true };
    } finally {
      undoing.delete(target.id);
    }
  }

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

{#if liveDay.fromMirror && liveDay.mirrorSavedAt}
  <p class="stale" data-testid="mirror-notice">{copy.showingMirror} {mirrorSavedWhen(liveDay.mirrorSavedAt, liveDay.wallNow)}.</p>
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
<div class="actions">
  <button class="action speaker" data-testid="action-bulletin" disabled={!$auth.user?.is_admin || !liveDay.itinerary} title={!$auth.user?.is_admin ? copy.conductorBulletinOnly : copy.tellTheCrew} onclick={() => liveDay.composing = true}><span aria-hidden="true">📣</span>{copy.bulletinAction}</button>
</div>
{#if tabStop && liveDay.media.length}<FreightStrip media={liveDay.media} />{/if}
{#if error && !ui.tabOpen}<p role="alert">{error}</p>{/if}
{#snippet toastView()}
  {#if toast || retry}
    <div class="toasts" class:floating={!ui.tabOpen}>
      {#if retry}
        <div class="toast" role="status" data-testid="tab-retry-toast">
          <span>{drinkIcons[retry.kind]} {(copy as Record<string, string>)[`drink_${retry.kind}`]}</span>
          <button type="button" onclick={() => void retrySend()} data-testid="tab-retry">{copy.tabRetry}</button>
        </div>
      {/if}
      {#if toast}
        <div class="toast" role="status" data-testid="tab-toast">
          <span>{copy.tabAdded} {drinkIcons[toast.kind]} {(copy as Record<string, string>)[`drink_${toast.kind}`]}</span>
          <button type="button" onclick={() => void undoDrink(toast!)} data-testid="tab-undo">{copy.undoDrink}</button>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}
{#if ui.tabOpen && liveDay.hasRoute}
  <TabSheet onclose={() => (ui.tabOpen = false)}>
    <!-- Counts read saved rows only. Undo my last one stays hidden while a photo is sending, so it is
         never mistaken for undoing that tap: the drink it would remove is an older one. -->
    <TabRow entries={liveDay.feed.drinks} stopId={tabStop?.id ?? null} userId={me} total={dayTotal} {clinking}
      sending={sending.map((s) => s.kind)} showUndoLast={!toast && !sending.length}
      onlog={(kind, photo) => void logDrink(kind, photo)} onundo={(entry) => void undoDrink(entry)} />
    {#if error}<p role="alert">{error}</p>{/if}
    {@render toastView()}
  </TabSheet>
{:else}
  {@render toastView()}
{/if}

<Leaderboard {leaders} />

{#if liveDay.itinerary && $auth.user}<CrewChat itineraryId={liveDay.itinerary.id} userId={$auth.user.id}
  onfiles={(files) => upload(files)} {uploading} {uploadError} />{/if}

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
  :global(body:has(.tabbar):has(.practice-banner)) .toasts.floating { bottom: calc(100px + env(safe-area-inset-bottom)); }
  .actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 0 0 14px; align-items: start; }
  .action { display: flex; width: 100%; margin: 0; flex-direction: row; align-items: center; justify-content: center; gap: 8px; border-radius: 16px; padding: 8px 5px; border: 1px solid #b5873b; color: #ffe3a3; background: linear-gradient(145deg, #443319, #211b13); box-shadow: 0 3px 0 #695024; font-size: 13px; }
  .action span { font-size: 22px; line-height: 1.2; }
  .action:active { transform: translateY(2px); box-shadow: none; }
  .speaker { background: linear-gradient(145deg, #403050, #241d2d); border-color: #886a9b; box-shadow: 0 3px 0 #574363; color: #efdcff; }
  .action:disabled { opacity: .45; box-shadow: none; }
  .stale { margin: 12px 0; padding: 10px 12px; border: 1px solid #555; border-radius: 9px; font-size: 13px; color: #cfcfcf; }
  .toasts { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  .toast { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 8px 8px 8px 16px; border-radius: 999px; background: #f2efe6; color: #111;
    font-weight: 700; }
  .toasts.floating { position: fixed; left: 50%; bottom: calc(76px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 16;
    margin: 0; }
  .floating .toast { box-shadow: 0 6px 20px #000a; }
  .toast button { width: auto; min-height: 36px; margin: 0; padding: 6px 14px; border-radius: 999px; background: #111; color: #ffb400; }
</style>
