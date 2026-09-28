<script lang="ts">
  // A venue's details on Add Stop, before it becomes a stop: its photos, hours and walk, with Add
  // stop at the bottom. Driven by ?venue= (see $lib/nav) so the back gesture closes it.
  import { pb } from '$lib/pb';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { hoursFor } from '$lib/live/venue';
  import type { Place, Venue } from '$lib/types';

  let { venue, weekday, walkMin, busy, error = '', onadd, onclose }: {
    venue: Venue | null; weekday: string; walkMin: number; busy: boolean; error?: string; onadd: () => void; onclose: () => void;
  } = $props();

  const hours = $derived(hoursFor(venue?.hours ?? null, weekday));
  const rated = $derived(venue?.rating !== undefined ? ` · ★ ${venue.rating.toFixed(1)}${venue.ratingCount ? ` (${venue.ratingCount})` : ''}` : '');

  // A stored venue's photos are fetched once on the server; a venue that is not stored has none.
  let place = $state<Place | null>(null);
  $effect(() => {
    const ref = venue?.placeRef;
    place = null;
    if (!ref) return;
    let stale = false;
    api<{ place: Place | null }>('/api/places/photos', { method: 'POST', json: { placeRef: ref } })
      .then((r) => { if (!stale) place = r.place; })
      .catch(() => undefined);
    return () => { stale = true; };
  });
  const photos = $derived(place ? (place.photos ?? []).map((f: string) => pb.files.getURL(place!, f, { thumb: '800x0' })) : []);

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (venue && !dialog.open) dialog.showModal();
    else if (!venue && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} class="sheet" aria-label={copy.venueDetails} data-testid="venue-sheet"
  oncancel={(e) => { e.preventDefault(); onclose(); }}>
  {#if venue}
    <div class="grab" aria-hidden="true"></div>
    <header>
      <h2>{venue.name}</h2>
      <p>{copy[`kind_${venue.kind}`]}{rated} · {walkMin} {copy.walkMinutes}</p>
      {#if venue.address}<p>{venue.address}</p>{/if}
    </header>
    {#if photos.length}
      <div class="gallery">
        {#each photos as url, i (url)}<img src={url} alt="" loading="lazy" data-testid="venue-photo-{i}" />{/each}
      </div>
    {/if}
    <section>
      <h3>{copy.hours}</h3>
      <p class="today">{hours.line ?? copy.hoursUnknown}</p>
    </section>
    <!-- The page's own error sits behind this modal, so a failed add is shown here too. -->
    {#if error}<p class="error" role="alert" data-testid="venue-sheet-error">{error}</p>{/if}
    <footer>
      <button type="button" class="secondary" onclick={onclose} data-testid="venue-sheet-close">{copy.closeSheet}</button>
      <button type="button" onclick={onadd} disabled={busy} data-testid="sheet-add">{copy.addThisStop}</button>
    </footer>
  {/if}
</dialog>

<style>
  .sheet { margin: auto 0 0; width: 100%; max-width: 760px; max-height: 88dvh; margin-inline: auto; padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
    border: 1px solid #3a3a3a; border-bottom: 0; border-radius: 22px 22px 0 0; background: #181818; color: #eee;
    overflow-y: auto; overscroll-behavior: contain; }
  /* A touch scroll that reaches the sheet's end must not carry on into the screen behind it. */
  :global(html:has(dialog.sheet[open])) { overflow: hidden; }
  .sheet[open] { animation: up .22s ease-out; }
  .sheet::backdrop { background: #000a; backdrop-filter: blur(3px); }
  @keyframes up { from { transform: translateY(40px); opacity: .4; } }
  @media (prefers-reduced-motion: reduce) { .sheet[open] { animation: none; } }
  .grab { width: 44px; height: 5px; border-radius: 3px; background: #555; margin: 4px auto 10px; }
  header { text-align: center; }
  h2 { margin: 0; font-size: 22px; }
  header p { margin: 2px 0 0; font-size: 14px; color: #aaa; }
  .gallery { display: flex; gap: 8px; overflow-x: auto; margin-top: 14px; }
  .gallery img { flex: none; width: 140px; height: 105px; object-fit: cover; display: block; border-radius: 10px; background: #222; }
  h3 { font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; margin: 18px 0 4px; }
  .today { color: #fff; font-weight: 700; margin: 0; }
  /* Add stop sits on the right, under a right thumb. */
  footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 18px; }
  footer button { width: auto; margin: 0; }
</style>
