<script lang="ts">
  // The Tab: its sheet, its camera and the drinks on their way. The app layout mounts it once, so the
  // tab bar opens the sheet over whatever screen is up, and a send finishes wherever its person went.
  // `shown` is false where the tab bar is not: sends carry on, but nothing of the Tab is drawn.
  import { ClientResponseError } from 'pocketbase';
  import { SvelteSet } from 'svelte/reactivity';
  import { afterNavigate } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { copy, drinkIcons } from '$lib/labels';
  import { auth, pb } from '$lib/pb';
  import type { DrinkEntry, DrinkKind, Media } from '$lib/types';
  import { liveDay } from '$lib/live/day.svelte';
  import { compressForUpload } from '$lib/live/upload';
  import { clockFailure, sameScope, sendProof, type ProofScope, type ProofSend, type ProofTap } from '$lib/live/proof';
  import { drinkCount } from '$lib/live/crew';
  import { newRecordId } from '$lib/live/staged';
  import TabRow from './TabRow.svelte';
  import TabSheet from './TabSheet.svelte';
  import { ui } from '$lib/ui.svelte';
  import { noTab } from '$lib/roles';

  let { shown }: { shown: boolean } = $props();

  // The sheet belongs to the screen it opened over: going anywhere closes it.
  afterNavigate(() => { ui.tabOpen = false; });
  // Signing out takes the Tab with it.
  onDestroy(() => { ui.tabOpen = false; ui.tabBusy = false; });
  // A screen without the tab bar (the reel, or the clock leaving the event day) has no sheet either.
  $effect(() => { if (!shown) ui.tabOpen = false; });
  // Trainspotters don't run a Tab: its sheet never opens for them.
  $effect(() => { if (noTab($auth.user)) ui.tabOpen = false; });

  let error = $state('');
  // Once the sheet is closed the error floats over the screen: briefly, as the failed Undo or Retry
  // it explains stays on offer in its own toast.
  $effect(() => {
    if (!error || ui.tabOpen) return;
    const message = error, timer = setTimeout(() => { if (error === message) error = ''; }, 6000);
    return () => clearTimeout(timer);
  });
  const me = $derived($auth.user?.id ?? '');
  const tabStop = $derived(liveDay.tabStop);

  // A drink is its photo: a tap sends one, and nothing counts until the server has it. These are
  // the photos still on their way (from the moment one is picked), each under the id its drink gets.
  let sending = $state<{ key: number; kind: DrinkKind }[]>([]);
  let sendKey = 0;
  // Sends that failed, each kept (with its photo and id) for Retry while its scope is current.
  let retries = $state<ProofSend[]>([]);
  let clinking = $state<DrinkKind | null>(null);
  // The toast's target stays until its delete succeeds, so a failed Undo can be retried.
  let toast = $state<{ id: string; kind: DrinkKind; failed: boolean } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  // Who, which route, which server day and which simulation run a send belongs to. A change of any
  // of them makes an unfinished send stale: no Retry, and a late answer is left to the feed's reload.
  const scope = $derived<ProofScope | null>(me && liveDay.itinerary
    ? { user: me, itinerary: liveDay.itinerary.id, day: liveDay.today, runId: clientClock.runId ?? null } : null);
  // A kept send goes when its scope changes, or once its drink is in the feed (the upload landed and only the answer was lost).
  $effect(() => {
    const saved = new Set(liveDay.feed.drinks.map((d) => d.id));
    if (retries.some((r) => !sameScope(r.scope, scope) || saved.has(r.id))) retries = retries.filter((r) => sameScope(r.scope, scope) && !saved.has(r.id));
  });
  // Only saved rows count, by the server's day.
  const dayTotal = $derived(drinkCount(liveDay.feed.drinks, me, liveDay.today));
  const showToast = (id: string, kind: DrinkKind) => {
    clearTimeout(toastTimer);
    toast = { id, kind, failed: false };
    toastTimer = setTimeout(() => { if (toast?.id === id && !toast.failed) toast = null; }, 4000);
  };

  // One camera for the Tab, outside the sheet: a photo taken after the sheet closed still arrives.
  // A tap captures where and for whom the drink is before the camera opens; the picker is modal,
  // so at most one tap is waiting for its photo.
  let camera = $state<HTMLInputElement>();
  let tapped: ProofTap | null = null;
  /** The Tab's camera is open: from the tap until it answers with a photo or a cancel. */
  let picking = $state(false);
  // Not every phone fires `cancel` when the camera is backed out of, and this flag outlives every screen:
  // once the page has the focus back for a moment, the camera is taken as closed. `tapped` stays, so a
  // photo that arrives later still sends.
  let pickTimer: ReturnType<typeof setTimeout> | undefined;
  function cameraMaybeClosed() {
    clearTimeout(pickTimer);
    if (picking) pickTimer = setTimeout(() => { picking = false; }, 1000);
  }
  // Live holds Closing Time back while any of this is unfinished.
  $effect(() => { ui.tabBusy = picking || sending.length > 0 || retries.length > 0; });
  function tap(kind: DrinkKind) {
    const stop = tabStop, at = scope;
    if (!stop || !at || !camera) return;
    tapped = { kind, stop: stop.id, scope: at };
    clearTimeout(pickTimer);
    picking = true;
    navigator.vibrate?.(30);
    camera.value = '';
    camera.click();   // from the click itself, so phones open the camera
  }
  // A cancelled picker fires no change (or a `cancel`): nothing was started, so nothing is undone.
  function picked() {
    clearTimeout(pickTimer);
    const photo = camera?.files?.[0], t = tapped;
    tapped = null;
    picking = false;
    if (camera) camera.value = '';
    if (photo && t) {
      // The new photo is on its way: the last drink's Undo must not stay live while it compresses.
      clearTimeout(toastTimer);
      toast = null;
      void logDrink(t, photo);
    }
  }

  // The camera answered: shrink the photo, then send it as the drink, at the stop it was tapped.
  async function logDrink(t: ProofTap, photo: File) {
    error = '';
    const key = ++sendKey;
    sending = [...sending, { key, kind: t.kind }];
    try {
      const prepared = await compressForUpload(photo);
      if (prepared.kind !== 'image') throw new Error(copy.proofNeedsImage);
      await submit({ id: newRecordId(), kind: t.kind, stop: t.stop, scope: t.scope, file: prepared.file, takenAt: prepared.takenAt });
    } catch (err) {
      // Only a photo the phone could not use lands here; there is nothing to retry.
      if (sameScope(t.scope, scope)) error = err instanceof Error ? err.message : copy.uploadFailed;
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
      result = sameScope(send.scope, scope) ? { status: 'failed', message: clockFailure(err), retryable: true } : { status: 'stale' };
    }
    const others = retries.filter((r) => r.id !== send.id);
    if (result.status === 'stale') { retries = others; return; }
    if (result.status === 'failed') { error = result.message; retries = result.retryable ? [...others, send] : others; return; }
    retries = others;
    if (result.drink) liveDay.upsertDrink(result.drink);
    if (result.media) liveDay.upsertMedia(result.media);
    clinking = send.kind;
    setTimeout(() => { if (clinking === send.kind) clinking = null; }, 400);
    showToast(send.id, send.kind);
    void liveDay.loadFeed();
  }

  // Retry sends every failed photo again under its own id, so a first attempt that did land counts once.
  async function retrySends() {
    const due = retries.filter((r) => sameScope(r.scope, scope));
    retries = [];
    if (!due.length) return;
    error = '';
    await Promise.all(due.map(async (send) => {
      const key = ++sendKey;
      sending = [...sending, { key, kind: send.kind }];
      try { await submit(send); } finally { sending = sending.filter((s) => s.key !== key); }
    }));
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
</script>

<svelte:window onfocus={cameraMaybeClosed} />
{#snippet toastView()}
  {#if toast || retries.length || (error && !ui.tabOpen)}
    <div class="toasts" class:floating={!ui.tabOpen}>
      {#if error && !ui.tabOpen}
        <div class="toast" role="alert" data-testid="tab-error">
          <span>{error}</span>
          <button type="button" onclick={() => { error = ''; }} aria-label={copy.closeSheet}>✕</button>
        </div>
      {/if}
      {#if retries.length}
        <div class="toast" role="status" data-testid="tab-retry-toast">
          <span>{#each retries as r, i (r.id)}{i ? ' · ' : ''}{drinkIcons[r.kind]} {(copy as Record<string, string>)[`drink_${r.kind}`]}{/each}</span>
          <button type="button" onclick={() => void retrySends()} data-testid="tab-retry">{copy.tabRetry}</button>
          <button type="button" onclick={() => { retries = []; }} data-testid="tab-retry-close" aria-label={copy.closeSheet}>✕</button>
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
<input bind:this={camera} type="file" accept="image/*" capture="environment" hidden onchange={picked} oncancel={() => { tapped = null; picking = false; }} data-testid="tab-camera" />
{#if shown}
  {#if ui.tabOpen && liveDay.hasRoute && !noTab($auth.user)}
    <TabSheet onclose={() => (ui.tabOpen = false)}>
      <!-- Counts read saved rows only. Undo my last one stays hidden while a photo is sending, so it is
           never mistaken for undoing that tap: the drink it would remove is an older one.
           `entries` is riderFeed (the crew count leaves trainspotters out); `total` and the saved-id
           check read the whole feed, because they are this person's own rows, whatever their role. -->
      <TabRow entries={liveDay.riderFeed.drinks} stopId={tabStop?.id ?? null} userId={me} total={dayTotal} {clinking}
        sending={sending.map((s) => s.kind)} showUndoLast={!toast && !sending.length}
        ontap={tap} onundo={(entry) => void undoDrink(entry)} />
      {#if error}<p role="alert">{error}</p>{/if}
      {@render toastView()}
    </TabSheet>
  {:else}
    {@render toastView()}
  {/if}
{/if}

<style>
  .toasts { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  .toast { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 8px 8px 8px 16px; border-radius: 999px; background: #f2efe6; color: #111;
    font-weight: 700; }
  .toasts.floating { position: fixed; left: 50%; bottom: calc(76px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 16;
    margin: 0; width: max-content; max-width: calc(100vw - 32px); }
  /* Live's practice banner sits on top of the tab bar; the toasts clear it too. */
  :global(body:has(.tabbar):has(.practice-banner)) .toasts.floating { bottom: calc(100px + env(safe-area-inset-bottom)); }
  .floating .toast { box-shadow: 0 6px 20px #000a; }
  .toast button { width: auto; min-height: 36px; margin: 0; padding: 6px 14px; border-radius: 999px; background: #111; color: #ffb400; }
</style>
