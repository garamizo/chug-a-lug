<script lang="ts">
  // The Bulletin the save drafted. The Conductor sends it, edits it, or saves without it.
  import { copy } from '$lib/labels';
  let { text, onsend, onskip, ondismiss }: {
    text: string; onsend: (body: string) => void; onskip: () => void;
    /** A Bulletin written from scratch can be walked away from: a tap outside or Escape. The one a
     *  save drafted cannot — there, closing would have to mean either sending it or not. */
    ondismiss?: () => void;
  } = $props();
  // Sentinel-initialized (not read from `text` directly) so svelte-check doesn't flag
  // state_referenced_locally; the effect below does the real sync. `{#if pending}` in the caller
  // does not remount this component when one draft replaces another (a truthy object to a new
  // truthy object), so the component has to notice the prop changing on its own rather than
  // relying on the caller to keep Save disabled while the sheet is open — a second draft's words
  // must replace the first's, not sit unseen under the first's still-mounted textarea.
  let syncedText: string | undefined = $state(undefined);
  let body = $state('');
  $effect(() => {
    if (text !== syncedText) {
      syncedText = text;
      body = text;
    }
  });
</script>

<svelte:window onkeydown={(e) => { if (ondismiss && e.key === 'Escape') ondismiss(); }} />
{#if ondismiss}<button type="button" class="scrim" aria-label={copy.close} onclick={ondismiss} data-testid="bulletin-scrim"></button>{/if}
<section class="sheet" data-testid="bulletin-sheet">
  <h2>{copy.tellTheCrew}</h2>
  <p>{copy.bulletinHint}</p>
  <textarea bind:value={body} rows="3" maxlength="500" data-testid="bulletin-body"></textarea>
  <button type="button" onclick={() => onsend(body.trim())} disabled={!body.trim()} data-testid="bulletin-send">{copy.sendBulletin}</button>
  <button type="button" class="secondary" onclick={onskip} data-testid="bulletin-skip">{copy.skipBulletin}</button>
</section>

<style>
  .scrim { position: fixed; inset: 0; z-index: 20; border: 0; border-radius: 0; margin: 0; padding: 0; width: auto; min-height: 0;
    background: rgba(0, 0, 0, .55); }
  .sheet { position: fixed; inset: auto 0 0; z-index: 20; background: #1b1b1b; border-top: 1px solid #444;
    border-radius: 16px 16px 0 0; padding: 18px 20px 24px; max-width: 760px; margin: 0 auto; }
  h2 { margin: 0 0 4px; font-size: 19px; }
  p { margin: 0; font-size: 13px; }
  textarea { width: 100%; margin-top: 12px; padding: 12px; font: inherit; font-size: 16px; border-radius: 10px;
    border: 1px solid #555; background: #202020; color: #fff; }
</style>
