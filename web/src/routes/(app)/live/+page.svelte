<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  // The shared `liveDay` owns the data so a Tab tap reaches every screen through the same tally.
  import compressionWorkerUrl from 'browser-image-compression/dist/browser-image-compression.js?url';
  import { ClientResponseError } from 'pocketbase';
  import { SvelteSet } from 'svelte/reactivity';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { goto } from '$app/navigation';
  import { copy, drinkIcons } from '$lib/labels';
  import { mirrorSavedWhen } from '$lib/offline';
  import { auth, pb } from '$lib/pb';
  import type { DrinkEntry, DrinkKind } from '$lib/types';
  import { liveDay } from '$lib/live/day.svelte';
  import { prepare, uploadBatch } from '$lib/live/upload';
  import { openStop } from '$lib/nav';
  import { stripStops } from '$lib/live/strip';
  import { withPending } from '$lib/live/tab';
  import { drinkCount } from '$lib/live/crew';
  import { topLine } from '$lib/live/leaderboard';
  import { newRecordId } from '$lib/live/staged';
  import CrewChat from '$lib/components/CrewChat.svelte';
  import StopSheet from '$lib/components/StopSheet.svelte';
  import RouteStrip from '$lib/components/RouteStrip.svelte';
  let fileInput = $state<HTMLInputElement>();
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import TabRow from '$lib/components/TabRow.svelte';
  import FreightStrip from '$lib/components/FreightStrip.svelte';
  import Leaderboard from '$lib/components/Leaderboard.svelte';

  let error = $state('');
  let uploading = $state(false);
  const here = $derived(liveDay.here);
  // The board retains a stop before and after the crawl, when the Tab and Freight must stay closed.
  const tabStop = $derived(here?.source === 'clock' || here?.source === 'override' ? here.stop : null);
  const strip = $derived(stripStops(liveDay.stops, liveDay.legs, here, liveDay.startAt));

  // Taps sent but not yet confirmed. Each has the id its row will be saved under.
  let pending = $state<DrinkEntry[]>([]);
  let clinking = $state<DrinkKind | null>(null);
  // The toast's target stays until its delete succeeds, so a failed Undo can be retried.
  let toast = $state<{ id: string; kind: DrinkKind; failed: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const me = $derived($auth.user?.id ?? '');
  const tabEntries = $derived(withPending(liveDay.feed.drinks, pending));
  // Saved rows count by the server's day; a tap in flight is today's by definition (the server stamps it).
  const dayTotal = $derived(drinkCount(liveDay.feed.drinks, me, liveDay.today)
    + pending.filter((p) => p.user === me && !liveDay.feed.drinks.some((d) => d.id === p.id)).length);
  const leaders = $derived($auth.user ? topLine(liveDay.feed.drinks, { id: $auth.user.id, name: $auth.user.name }, liveDay.today) : []);
  const showToast = (id: string, kind: DrinkKind) => {
    clearTimeout(toastTimer);
    toast = { id, kind, failed: false };
    toastTimer = setTimeout(() => { if (toast?.id === id && !toast.failed) toast = null; }, 4000);
  };

  async function logDrink(kind: DrinkKind) {
    const stop = tabStop, user = $auth.user;
    if (!stop || !user) return;
    error = '';
    // Only an optimistic guess at wall time: the server stamps the saved row.
    liveDay.syncNow();
    const at = liveDay.realNow.toISOString();
    const draft = { id: newRecordId(), user: user.id, stop: stop.id, kind, at } as DrinkEntry;
    pending = [...pending, draft];
    clinking = kind;
    setTimeout(() => { if (clinking === kind) clinking = null; }, 400);
    navigator.vibrate?.(30);
    // A new tap supersedes whatever the toast was showing: hide it now, so Undo can never remove
    // the previous drink while this one is still in flight. showToast below retargets it once this
    // tap is confirmed.
    clearTimeout(toastTimer);
    toast = null;
    try {
      await clientClock.ready();
      liveDay.syncNow();
      if (tabStop?.id !== stop.id) throw new Error(copy.simClockConflict);
      const row = await pb.collection('drink_entries').create<DrinkEntry>(
        { id: draft.id, user: user.id, stop: stop.id, kind, at: liveDay.realNow.toISOString() },
        { expand: 'user,stop' });
      liveDay.upsertDrink(row);
      showToast(row.id, kind);
      void liveDay.loadFeed();
    } catch { error = copy.noSignal; }
    finally { pending = pending.filter((p) => p.id !== draft.id); }
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

  async function upload(files: FileList | null) {
    const selected = Array.from(files ?? []);
    const stop = tabStop, user = $auth.user;
    if (!selected.length || !stop || !user || uploading) return;
    error = '';
    uploading = true;
    try {
      await clientClock.ready();
      liveDay.syncNow();
      if (tabStop?.id !== stop.id) throw new Error(copy.simClockConflict);
      error = await uploadBatch(selected, async (file) => {
        const prepared = await prepare(file, async (f) => {
          const { default: compressImage } = await import('browser-image-compression');
          return compressImage(f, { maxWidthOrHeight: 2000, initialQuality: 0.8, useWebWorker: true, libURL: new URL(compressionWorkerUrl, location.href).href });
        });
        const form = new FormData();
        form.set('user', user.id);
        form.set('stop', stop.id);
        form.set('kind', prepared.kind);
        form.set('taken_at', prepared.takenAt);
        form.set('file', prepared.file);
        await clientClock.ready();
        await pb.collection('media').create(form);
      }, () => liveDay.loadFeed());
    } catch { error = copy.noSignal; } finally { uploading = false; }
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
  <DepartureBoard
    station={here.stop.station_name || here.stop.station_id}
    stopName={here.stop.name}
    nextStation={here.onwardStop?.station_name || here.onwardStop?.station_id || ''}
    trip={liveDay.trip}
    walkMin={here.stop.walk_min}
    now={liveDay.now}
    mode={liveDay.mode}
    rtFetchedAt={liveDay.rtFetchedAt} />
  <RouteStrip items={strip} onopen={openStop} />
{/if}
{#if liveDay.practice}<p class="practice-banner" data-testid="practice-badge" title={copy.practiceHint}>{copy.practiceBadge}</p>{/if}
<!-- `!pending.length` keeps the fallback off a tap still in flight: while it's non-empty,
     tabEntries carries drafts with no saved row yet, and deleting one 404s (or races a later
     upsertDrink back in). Once pending is empty, tabEntries is exactly liveDay.feed.drinks, so
     tally()'s lastMine can only be a saved entry. -->
<TabRow entries={tabEntries} stopId={tabStop?.id ?? null} userId={me} total={dayTotal} {clinking}
  showUndoLast={!toast && !pending.length}
  onlog={(kind) => void logDrink(kind)} onundo={(entry) => void undoDrink(entry)} />
<div class="actions">
  <div class="photo-action">
    <button class="action photo" data-testid="action-photo" disabled={!tabStop || uploading} onclick={() => fileInput?.click()}><span aria-hidden="true">📸</span>{uploading ? copy.uploading : copy.addPhoto}</button>
    {#if tabStop && $auth.user}
      <input class="file" bind:this={fileInput} type="file" accept="image/*,video/*" multiple disabled={uploading} onchange={e => { void upload(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid="freight-input" />
      <label class="camera">{copy.takePhoto}<input type="file" accept="image/*" capture="environment" disabled={uploading} onchange={e => { void upload(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid="freight-camera" /></label>
    {/if}
  </div>
  <button class="action speaker" data-testid="action-bulletin" disabled={!$auth.user?.is_admin || !liveDay.itinerary} title={!$auth.user?.is_admin ? copy.conductorBulletinOnly : copy.tellTheCrew} onclick={() => liveDay.composing = true}><span aria-hidden="true">📣</span>{copy.bulletinAction}</button>
</div>
{#if tabStop && liveDay.media.length}<FreightStrip media={liveDay.media} busy={uploading} showPicker={false} onpick={(files) => void upload(files)} />{/if}
{#if error}<p role="alert">{error}</p>{/if}
{#if toast}
  <div class="toast" role="status" data-testid="tab-toast">
    <span>{copy.tabAdded} {drinkIcons[toast.kind]} {(copy as Record<string, string>)[`drink_${toast.kind}`]}</span>
    <button type="button" onclick={() => void undoDrink(toast!)} data-testid="tab-undo">{copy.undoDrink}</button>
  </div>
{/if}

<Leaderboard {leaders} />

{#if liveDay.itinerary && $auth.user}<CrewChat itineraryId={liveDay.itinerary.id} userId={$auth.user.id} />{/if}

{#if liveDay.itinerary}
  <StopSheet stops={liveDay.stops} media={liveDay.feed.media} eventDate={liveDay.itinerary.event_date}
    itineraryId={liveDay.itinerary.id} isAdmin={!!$auth.user?.is_admin} />
{/if}

<style>
  /* A flat strip pinned to the foot of the screen. Practice days have no TabBar to share it with. */
  .practice-banner { position: fixed; left: 0; right: 0; bottom: 0; z-index: 15; margin: 0; padding: 4px 0 calc(4px + env(safe-area-inset-bottom));
    background: #1d3440; color: #bfe3f2; text-align: center; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; line-height: 1.4; }
  :global(body:has(.practice-banner)) { padding-bottom: calc(24px + env(safe-area-inset-bottom)); }
  .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 0 0 14px; align-items: start; }
  .action { display: flex; width: 100%; margin: 0; flex-direction: row; align-items: center; justify-content: center; gap: 8px; border-radius: 16px; padding: 8px 5px; border: 1px solid #b5873b; color: #ffe3a3; background: linear-gradient(145deg, #443319, #211b13); box-shadow: 0 3px 0 #695024; font-size: 13px; }
  .action span { font-size: 22px; line-height: 1.2; }
  .action:active { transform: translateY(2px); box-shadow: none; }
  .photo { background: linear-gradient(145deg, #203e42, #152225); border-color: #547c83; box-shadow: 0 3px 0 #345057; color: #cfedf2; }
  .speaker { background: linear-gradient(145deg, #403050, #241d2d); border-color: #886a9b; box-shadow: 0 3px 0 #574363; color: #efdcff; }
  .action:disabled { opacity: .45; box-shadow: none; }
  .file { display: none; }
  .camera { position: relative; display: block; font-size: 11px; text-align: center; margin-top: 8px; color: #cfedf2; text-decoration: underline; min-height: 24px; }
  .camera input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
  .stale { margin: 12px 0; padding: 10px 12px; border: 1px solid #555; border-radius: 9px; font-size: 13px; color: #cfcfcf; }
  .toast { position: fixed; left: 50%; bottom: calc(76px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 16;
    display: flex; align-items: center; gap: 14px; padding: 8px 8px 8px 16px; border-radius: 999px; background: #f2efe6; color: #111;
    font-weight: 700; box-shadow: 0 6px 20px #000a; }
  .toast button { width: auto; min-height: 36px; margin: 0; padding: 6px 14px; border-radius: 999px; background: #111; color: #ffb400; }
</style>
