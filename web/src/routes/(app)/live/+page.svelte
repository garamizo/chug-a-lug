<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  // The shared `liveDay` owns the data so a Tab tap reaches every screen through the same tally.
  import { goto } from '$app/navigation';
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { mirrorSavedWhen } from '$lib/offline';
  import { auth, pb } from '$lib/pb';
  import type { DrinkEntry, DrinkKind } from '$lib/types';
  import { liveDay } from '$lib/live/day.svelte';
  import { prepare, uploadBatch } from '$lib/live/upload';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import TabRow from '$lib/components/TabRow.svelte';
  import FreightStrip from '$lib/components/FreightStrip.svelte';

  let error = $state('');
  let uploading = $state(false);
  const here = $derived(liveDay.here);
  // The board retains a stop before and after the crawl, when the Tab and Freight must stay closed.
  const tabStop = $derived(here?.source === 'clock' || here?.source === 'override' ? here.stop : null);
  const remaining = $derived(liveDay.stops.filter((s) => s.order > (here?.stop?.order ?? 0)));

  async function logDrink(kind: DrinkKind) {
    const stop = tabStop, user = $auth.user;
    if (!stop || !user) return;
    error = '';
    try {
      await pb.collection('drink_entries').create({ user: user.id, stop: stop.id, kind, at: new Date().toISOString() });
      await liveDay.loadDrinks();
    } catch { error = copy.noSignal; }
  }

  async function undoDrink(entry: DrinkEntry) {
    error = '';
    try { await pb.collection('drink_entries').delete(entry.id); await liveDay.loadDrinks(); }
    catch { error = copy.noSignal; }
  }

  async function upload(files: FileList | null) {
    const stop = tabStop, user = $auth.user;
    if (!files?.length || !stop || !user || uploading) return;
    error = '';
    uploading = true;
    try {
      error = await uploadBatch(Array.from(files), async (file) => {
        const prepared = await prepare(file, async (f) => {
          const { default: compressImage } = await import('browser-image-compression');
          return compressImage(f, { maxWidthOrHeight: 2000, initialQuality: 0.8, useWebWorker: true });
        });
        const form = new FormData();
        form.set('user', user.id);
        form.set('stop', stop.id);
        form.set('kind', prepared.kind);
        form.set('taken_at', prepared.takenAt);
        form.set('file', prepared.file);
        await pb.collection('media').create(form);
      }, () => liveDay.loadMedia());
    } finally { uploading = false; }
  }
</script>

<svelte:head><title>{copy.live}</title></svelte:head>

{#if liveDay.fromMirror && liveDay.mirrorSavedAt}
  <p class="stale" data-testid="mirror-notice">{copy.showingMirror} {mirrorSavedWhen(liveDay.mirrorSavedAt, liveDay.now)}.</p>
{/if}

{#if !liveDay.itinerary || !liveDay.isToday}
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
{/if}

{#if tabStop && $auth.user}
  <TabRow entries={liveDay.drinks} stopId={tabStop.id} userId={$auth.user.id}
    onlog={(kind) => void logDrink(kind)} onundo={(entry) => void undoDrink(entry)} />
  <FreightStrip media={liveDay.media} busy={uploading} onpick={(files) => void upload(files)} />
{:else}
  <section class="tabclosed"><h2>{copy.tabTitle}</h2><p>{copy.tabClosed}</p></section>
{/if}
{#if error}<p role="alert">{error}</p>{/if}

{#if here?.stop}
  <section class="rest">
    <h2>{copy.stillToCome}</h2>
    {#each remaining as stop (stop.id)}
      {@const leg = liveDay.legs.find((l) => l.to_stop === stop.id)}
      <div class="row">
        <span class="when">{leg?.arrive_at ? fmtTime(leg.arrive_at) : ''}</span>
        <span class="name">{stop.name}</span>
        <span class="where">{stop.station_name}</span>
      </div>
    {/each}
  </section>
{/if}

<style>
  .stale { margin: 12px 20px; padding: 10px 12px; border: 1px solid #555; border-radius: 9px; font-size: 13px; color: #cfcfcf; }
  .rest, .tabclosed { padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .row { display: flex; align-items: baseline; gap: 12px; padding: 11px 0; border-bottom: 1px solid #2a2a2a; }
  .when { font-variant-numeric: tabular-nums; font-size: 15px; color: #9a9a9a; width: 68px; flex: none; }
  .name { flex-grow: 1; font-size: 16px; }
  .where { font-size: 13px; color: #9a9a9a; }
</style>
