<script lang="ts">
  // Full-screen Freight and venue photos. Swiping is the browser's own scroll snapping; pinch zoom
  // is the browser's own zoom. Back closes it.
  import { page } from '$app/state';
  import { copy } from '$lib/labels';
  import { closeLightbox } from '$lib/nav';
  const box = $derived(page.state.lightbox);
  let dialog = $state<HTMLDialogElement>();
  let track = $state<HTMLDivElement>();
  $effect(() => {
    if (!dialog) return;
    if (box && !dialog.open) dialog.showModal();
    else if (!box && dialog.open) dialog.close();
  });
  $effect(() => { if (box && track) track.scrollTo({ left: track.clientWidth * box.index }); });
</script>

<!-- A native modal dialog: opened after the stop sheet's own showModal(), it stacks above it in the
     top layer and makes the sheet inert until it closes. A plain div would sit behind the sheet. -->
<dialog bind:this={dialog} class="lightbox" aria-label={copy.photoViewer} data-testid="lightbox"
  oncancel={(e) => { e.preventDefault(); closeLightbox(); }}>
  {#if box}
    <button type="button" class="close" onclick={closeLightbox} aria-label={copy.closeViewer} data-testid="lightbox-close">✕</button>
    <div class="track" bind:this={track}>
      {#each box.items as item, i (i)}
        <figure>
          {#if item.kind === 'video'}<!-- svelte-ignore a11y_media_has_caption --><video src={item.full} controls playsinline preload="metadata"></video>
          {:else}<img src={item.url} alt="" />{/if}
          <figcaption>{#if item.caption}{item.caption} · {/if}<a href={item.full} target="_blank" rel="noopener" download>{copy.downloadOriginal}</a></figcaption>
        </figure>
      {/each}
    </div>
  {/if}
</dialog>

<style>
  .lightbox { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: #000; color: #fff; }
  .lightbox::backdrop { background: #000; }
  .close { position: absolute; top: max(12px, env(safe-area-inset-top)); right: 12px; z-index: 1; width: 48px; height: 48px;
    margin: 0; padding: 0; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; border: 1px solid #555; }
  .track { display: flex; height: 100%; overflow-x: auto; scroll-snap-type: x mandatory; }
  figure { flex: 0 0 100%; margin: 0; scroll-snap-align: center; display: flex; flex-direction: column; justify-content: center; }
  img, video { width: 100%; max-height: 85dvh; object-fit: contain; }
  figcaption { color: #bbb; font-size: 13px; text-align: center; padding: 10px 16px; }
</style>
