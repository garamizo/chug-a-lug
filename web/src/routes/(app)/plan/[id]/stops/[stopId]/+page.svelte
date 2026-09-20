<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, auth, subscribe } from '$lib/pb';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import Votes from '$lib/components/Votes.svelte';
  import Comments from '$lib/components/Comments.svelte';
  import type { AttachResult, Itinerary, Stop, StopPhoto } from '$lib/types';

  let { data } = $props();
  let itinerary = $state<Itinerary | null>(null);
  let stop = $state<Stop | null>(null);
  let photos = $state<StopPhoto[]>([]);
  let notes = $state('');
  let phone = $state('');
  let confirmedOpen = $state(false);
  let saveStatus = $state('');
  let photoError = $state('');
  let error = $state('');
  let busy = $state(false);

  async function load() {
    try {
      const [it, st, ph] = await Promise.all([
        pb.collection('itineraries').getOne<Itinerary>(data.id),
        pb.collection('stops').getOne<Stop>(data.stopId),
        pb.collection('stop_photos').getFullList<StopPhoto>({ filter: pb.filter('stop = {:id}', { id: data.stopId }), sort: 'created' })
      ]);
      itinerary = it; stop = st; photos = ph;
      notes = st.notes ?? ''; phone = st.phone ?? ''; confirmedOpen = !!st.confirmed_open;
    } catch { error = copy.loadError; }
  }
  onMount(() => {
    void load();
    const unsubs = [
      subscribe('stops', pb.filter('id = {:id}', { id: data.stopId }), load),
      subscribe('stop_photos', pb.filter('stop = {:id}', { id: data.stopId }), load)
    ];
    return () => unsubs.forEach((u) => u());
  });

  const editable = $derived(!!itinerary && (itinerary.status === 'draft' || !!$auth.user?.is_admin));
  const mapsUrl = $derived(!stop ? '' : stop.place_id
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}&query_place_id=${encodeURIComponent(stop.place_id)}`
    : `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lon}`);
  const photoUrl = (p: StopPhoto) => pb.files.getURL(p, p.file, { thumb: '800x0' });

  async function save() {
    if (!stop || busy) return;
    busy = true; saveStatus = ''; error = '';
    try {
      await pb.collection('stops').update(stop.id, { notes, phone, confirmed_open: confirmedOpen });
      saveStatus = copy.saved;
    } catch (err) { error = (err as Error).message || copy.genericError; }
    finally { busy = false; }
  }

  async function retry() {
    if (!stop) return;
    photoError = '';
    try {
      const result = await api<AttachResult>('/api/places/attach', { method: 'POST', json: { stopId: stop.id } });
      if (result.status === 'failed') photoError = result.message ?? copy.photosFailed;
      await load();
    } catch (err) { photoError = (err as Error).message; }
  }
</script>

<p><a href="/plan/{data.id}">← {copy.backToDraft}</a></p>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if stop}
  <h1 data-testid="stop-name">{stop.name}</h1>
  <p class="meta">{copy[`kind_${stop.kind ?? 'other'}`]} · {stop.station_name || stop.station_id} · {stop.walk_min} {copy.walkMinutes}</p>
  {#if stop.address}<p class="meta">{stop.address}</p>{/if}
  <p><a href={mapsUrl} target="_blank" rel="noopener" data-testid="maps-link">{copy.openInMaps}</a></p>

  <section>
    {#if photos.length}
      <div class="grid">
        {#each photos as p, i (p.id)}
          <figure><img src={photoUrl(p)} alt="" loading="lazy" data-testid="photo-{i}" /><figcaption>{p.attribution}</figcaption></figure>
        {/each}
      </div>
    {/if}
    <p class="meta" data-testid="photos-status">
      {#if photoError}{photoError}
      {:else if stop.photos_status === 'pending'}{copy.photosPending}
      {:else if stop.photos_status === 'failed'}{copy.photosFailed}
      {:else if !photos.length}{copy.noPhotos}
      {:else}{copy.googleAttribution}{/if}
    </p>
    {#if editable && stop.photos_status !== 'pending' && (stop.photos_status !== 'done' || !photos.length)}
      <button type="button" class="secondary" onclick={retry} data-testid="retry-photos">{copy.retryPhotos}</button>
    {/if}
  </section>

  <section>
    <h2>{copy.hours}</h2>
    {#if stop.hours?.source === 'google'}
      <ul class="hours">{#each stop.hours.weekday as line}<li class:sat={line.startsWith('Saturday')}>{line}</li>{/each}</ul>
    {:else if stop.hours?.source === 'osm'}
      <p>{stop.hours.raw}</p>
    {:else}
      <p>{copy.hoursUnknown}</p>
    {/if}
    {#if stop.website}<p><a href={stop.website} target="_blank" rel="noopener">{copy.website}</a></p>{/if}
  </section>

  <section>
    <h2>{copy.notes}</h2>
    <label for="notes" class="sr">{copy.notes}</label>
    <textarea id="notes" rows="3" bind:value={notes} placeholder={copy.notesPlaceholder} disabled={!editable} data-testid="notes"></textarea>
    <label class="check"><input type="checkbox" bind:checked={confirmedOpen} disabled={!editable} data-testid="confirmed-open" /> {copy.confirmedOpen}</label>
    <label for="phone">{copy.confirmPhone}</label>
    <input id="phone" type="tel" bind:value={phone} disabled={!editable} data-testid="confirm-phone" />
    {#if stop.phone}<p class="meta"><a href="tel:{stop.phone}">{stop.phone}</a></p>{/if}
    {#if editable}<button type="button" onclick={save} disabled={busy} data-testid="save-stop">{busy ? copy.working : copy.save}</button>{/if}
    {#if saveStatus}<p class="meta" data-testid="save-status">{saveStatus}</p>{/if}
  </section>

  <Votes targetCollection="stops" targetId={stop.id} />
  <Comments targetCollection="stops" targetId={stop.id} />
{/if}

<style>
  .meta { color: #aaa; font-size: 15px; margin: 4px 0; }
  section { margin-top: 24px; }
  h2 { font-size: 18px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  figure { margin: 0; }
  img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px; }
  figcaption { font-size: 11px; color: #888; }
  .hours { list-style: none; padding: 0; color: #ccc; }
  .hours .sat { color: #fff; font-weight: 700; }
  textarea { font: inherit; font-size: 16px; width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #666; background: #202020; color: #fff; }
  .check { display: flex; align-items: center; gap: 10px; }
  .check input { width: 24px; height: 24px; margin: 0; }
  .sr { position: absolute; left: -9999px; }
</style>
