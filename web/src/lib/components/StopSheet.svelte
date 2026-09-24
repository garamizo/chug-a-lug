<script lang="ts">
  // A stop's details over whatever screen opened it. Read-only: the planning page is where stops are
  // edited. Driven by ?stop= so the back gesture closes it and a link can open it.
  import { pb } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { fmtWeekday } from '$lib/time';
  import { closeStop, openLightbox, pageStop, sheetStopId } from '$lib/nav';
  import { hoursFor, safeWebsite, telHref, walkUrl } from '$lib/live/venue';
  import type { LightboxItem, Media, Stop } from '$lib/types';

  let { stops, media, eventDate, itineraryId, isAdmin }: {
    stops: Stop[]; media: Media[]; eventDate: string; itineraryId: string; isAdmin: boolean;
  } = $props();

  const ordered = $derived([...stops].sort((a, b) => a.order - b.order));
  const index = $derived(ordered.findIndex((s) => s.id === sheetStopId()));
  const stop = $derived(index >= 0 ? ordered[index] : null);
  const place = $derived(stop?.expand?.place);
  const hours = $derived(hoursFor(stop?.hours ?? null, fmtWeekday(eventDate)));
  const tel = $derived(telHref(stop?.phone));
  const website = $derived(safeWebsite(stop?.website));
  const gallery = $derived<LightboxItem[]>(!stop ? [] : [
    ...(place?.photos ?? []).map((f: string) => ({ url: pb.files.getURL(place!, f, { thumb: '800x0' }), full: pb.files.getURL(place!, f), kind: 'image' as const, caption: copy.googlePhoto })),
    ...media.filter((m) => m.stop === stop.id).map((m) => ({ url: pb.files.getURL(m, m.file, { thumb: '1200x0' }), full: pb.files.getURL(m, m.file), kind: m.kind, caption: m.expand?.user?.name }))
  ]);

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (stop && !dialog.open) dialog.showModal();
    else if (!stop && dialog.open) dialog.close();
  });
  let startX = 0;
  const go = (step: number) => { const next = ordered[index + step]; if (next) pageStop(next.id); };
</script>

<dialog bind:this={dialog} class="sheet" aria-label={copy.stopDetails} data-testid="stop-sheet"
  oncancel={(e) => { e.preventDefault(); closeStop(); }}
  ontouchstart={(e) => (startX = e.touches[0].clientX)}
  ontouchend={(e) => { const dx = e.changedTouches[0].clientX - startX; if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); }}>
  {#if stop}
    <div class="grab" aria-hidden="true"></div>
    <header>
      <button type="button" class="nav" onclick={() => go(-1)} disabled={index <= 0} aria-label={copy.previousStop} data-testid="sheet-prev">‹</button>
      <div class="title">
        <h2 data-testid="sheet-name">{stop.name}</h2>
        <p>{copy[`kind_${stop.kind ?? 'other'}`]} · {stop.station_name || stop.station_id} · {stop.walk_min} {copy.walkMinutes}</p>
      </div>
      <button type="button" class="nav" onclick={() => go(1)} disabled={index >= ordered.length - 1} aria-label={copy.nextStop} data-testid="sheet-next">›</button>
    </header>
    {#if stop.confirmed_open}<p class="badge">✓ {copy.confirmedOpenBadge}</p>{/if}
    <div class="buttons">
      <a class="big" href={walkUrl(stop)} target="_blank" rel="noopener" data-testid="sheet-walk">🚶 {copy.walkThere}</a>
      {#if tel}<a class="big" href={tel} data-testid="sheet-call">📞 {copy.callStop}</a>{/if}
    </div>
    {#if gallery.length}
      <div class="gallery">
        {#each gallery as item, i (item.full)}
          <button type="button" onclick={() => openLightbox(gallery, i)}>
            {#if item.kind === 'image'}<img src={item.url} alt="" loading="lazy" />{:else}<span class="video">▶</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
    <section>
      <h3>{copy.hours}</h3>
      <p class="today">{hours.line ?? copy.hoursUnknown}</p>
      {#if hours.rest.length}<details><summary>{copy.otherDays}</summary><ul>{#each hours.rest as line}<li>{line}</li>{/each}</ul></details>{/if}
      {#if website}<p><a href={website} target="_blank" rel="noopener">{copy.website}</a></p>{/if}
    </section>
    {#if stop.notes}<section><h3>{copy.notes}</h3><p class="notes">{stop.notes}</p></section>{/if}
    <footer>
      {#if isAdmin}<a href="/plan/{itineraryId}/stops/{stop.id}" data-testid="sheet-edit">{copy.editDetails}</a>{/if}
      <button type="button" class="secondary" onclick={closeStop} data-testid="sheet-close">{copy.closeSheet}</button>
    </footer>
  {/if}
</dialog>

<style>
  .sheet { margin: auto 0 0; width: 100%; max-width: 760px; max-height: 88dvh; margin-inline: auto; padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
    border: 1px solid #3a3a3a; border-bottom: 0; border-radius: 22px 22px 0 0; background: #181818; color: #eee; }
  .sheet[open] { animation: up .22s ease-out; }
  .sheet::backdrop { background: #000a; backdrop-filter: blur(3px); }
  @keyframes up { from { transform: translateY(40px); opacity: .4; } }
  @media (prefers-reduced-motion: reduce) { .sheet[open] { animation: none; } }
  .grab { width: 44px; height: 5px; border-radius: 3px; background: #555; margin: 4px auto 10px; }
  header { display: flex; align-items: center; gap: 8px; }
  .title { flex-grow: 1; text-align: center; }
  h2 { margin: 0; font-size: 22px; }
  .title p { margin: 2px 0 0; font-size: 14px; color: #aaa; }
  .nav { width: 44px; min-height: 44px; margin: 0; padding: 0; background: transparent; color: #ffce5c; border: 1px solid #444; font-size: 24px; }
  .badge { margin: 12px 0 0; color: #7fd17f; font-size: 14px; text-align: center; }
  .buttons { display: flex; gap: 10px; margin-top: 14px; }
  .big { flex: 1; text-align: center; padding: 14px; border-radius: 12px; background: #ffb400; color: #111; font-weight: 750; text-decoration: none; }
  .gallery { display: flex; gap: 8px; overflow-x: auto; margin-top: 14px; }
  .gallery button { flex: none; width: 140px; min-height: 0; margin: 0; padding: 0; background: #222; border-radius: 10px; overflow: hidden; }
  .gallery img { width: 140px; height: 105px; object-fit: cover; display: block; }
  .video { display: grid; place-items: center; height: 105px; color: #fff; }
  h3 { font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; margin: 18px 0 4px; }
  .today { color: #fff; font-weight: 700; margin: 0; }
  .notes { white-space: pre-wrap; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; }
  footer button { width: auto; margin: 0; }
</style>
