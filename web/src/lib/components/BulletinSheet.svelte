<script lang="ts">
  // The Bulletin the save drafted. The Conductor sends it, edits it, or saves without it.
  import { copy } from '$lib/labels';
  let { text, onsend, onskip }: { text: string; onsend: (body: string) => void; onskip: () => void } = $props();
  let body = $state(text);
</script>

<section class="sheet" data-testid="bulletin-sheet">
  <h2>{copy.tellTheCrew}</h2>
  <p>{copy.bulletinHint}</p>
  <textarea bind:value={body} rows="3" maxlength="500" data-testid="bulletin-body"></textarea>
  <button type="button" onclick={() => onsend(body.trim())} disabled={!body.trim()} data-testid="bulletin-send">{copy.sendBulletin}</button>
  <button type="button" class="secondary" onclick={onskip} data-testid="bulletin-skip">{copy.skipBulletin}</button>
</section>

<style>
  .sheet { position: fixed; inset: auto 0 0; z-index: 20; background: #1b1b1b; border-top: 1px solid #444;
    border-radius: 16px 16px 0 0; padding: 18px 20px 24px; max-width: 760px; margin: 0 auto; }
  h2 { margin: 0 0 4px; font-size: 19px; }
  p { margin: 0; font-size: 13px; }
  textarea { width: 100%; margin-top: 12px; padding: 12px; font: inherit; font-size: 16px; border-radius: 10px;
    border: 1px solid #555; background: #202020; color: #fff; }
</style>
