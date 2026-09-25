<script lang="ts">
  // Freight from this stop: proof your shot landed. The album, the lightbox and the downloads are
  // Closing Time's business.
  import { copy, labels } from '$lib/labels';
  import { pb } from '$lib/pb';
  import { openLightbox } from '$lib/nav';
  import type { LightboxItem, Media } from '$lib/types';
  let { media, busy, onpick, showPicker = true }: { showPicker?: boolean; media: Media[]; busy: boolean; onpick: (files: FileList | null) => void } = $props();
  const thumb = (m: Media) => pb.files.getURL(m, m.file, { thumb: '400x300' });
  const full = (m: Media) => pb.files.getURL(m, m.file);
  const items = $derived<LightboxItem[]>(media.map((m) => ({ url: pb.files.getURL(m, m.file, { thumb: '1200x0' }), full: full(m), kind: m.kind })));
</script>

<section class="freight">
  <h2>{labels.media}</h2>
  {#if showPicker}
  <label class="pick">
    {busy ? copy.uploading : copy.addFreight}
    <input type="file" accept="image/*,video/*" multiple disabled={busy}
      onchange={(e) => onpick((e.currentTarget as HTMLInputElement).files)} data-testid="freight-input" />
  </label>
  <label class="pick">
    {copy.takePhoto}
    <input type="file" accept="image/*" capture="environment" disabled={busy}
      onchange={(e) => onpick(e.currentTarget.files)} data-testid="freight-camera" />
  </label>
  {/if}
  {#if media.length === 0}
    <p data-testid="freight-empty">{copy.noFreightYet}</p>
  {:else}
    <div class="strip" data-testid="freight-strip">
      {#each media as item, i (item.id)}
        <button type="button" class="thumb" onclick={() => openLightbox(items, i)} data-testid="freight-open-{i}"
          aria-label={item.kind === 'image' ? copy.openFreightPhoto : copy.openFreightVideo}>
          {#if item.kind === 'image'}<img src={thumb(item)} alt="" width="120" height="90" />{:else}<span class="video">▶</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .freight { padding: 0 0 18px; }
  .pick { display: block; text-align: center; background: #1b1b1b; border: 1px solid #333; border-radius: 10px;
    padding: 14px; font-weight: 700; color: #ffce5c; cursor: pointer; }
  .pick { position: relative; margin-bottom: 8px; }
  .pick input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
  .strip { display: flex; gap: 8px; overflow-x: auto; padding-top: 10px; }
  .thumb { width: auto; min-height: 0; margin: 0; padding: 0; background: none; border: 0; flex: none; }
  .strip img { border-radius: 8px; object-fit: cover; }
  .video { display: grid; place-items: center; width: 120px; height: 90px; background: #222; border-radius: 8px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
</style>
