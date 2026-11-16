<script lang="ts">
  // One tap per drink at the stop the crawl is in, and each tap is a photo: the button opens the
  // camera, and the drink counts once its photo lands. The header counts the whole day for this person.
  import { copy, drinkIcons } from '$lib/labels';
  import { DRINK_KINDS, tally } from '$lib/live/tab';
  import type { DrinkEntry, DrinkKind } from '$lib/types';
  let { entries, stopId, userId, total, clinking, sending, showUndoLast, onlog, onundo }: {
    entries: DrinkEntry[]; stopId: string | null; userId: string; total: number;
    clinking: DrinkKind | null; showUndoLast: boolean;
    /** Kinds with a photo still on its way: shown as sending, not counted. */
    sending: DrinkKind[];
    onlog: (kind: DrinkKind, photo: File) => void; onundo: (entry: DrinkEntry) => void;
  } = $props();
  const counts = $derived(tally(entries, stopId ?? '', userId));
  // One camera for all five buttons: the picker is modal, so only one kind is ever being chosen.
  let camera = $state<HTMLInputElement>();
  let choosing: DrinkKind | null = null;
  // Opened from the tap's own click handler, so phones treat it as a user gesture.
  function snap(kind: DrinkKind) {
    if (!camera) return;
    choosing = kind;
    camera.value = '';
    camera.click();
  }
  // A cancelled picker fires no change (or a `cancel`): nothing was started, so nothing is undone.
  function picked() {
    const photo = camera?.files?.[0], kind = choosing;
    choosing = null;
    if (camera) camera.value = '';
    if (photo && kind) onlog(kind, photo);
  }
</script>

<section class="tab">
  <h2>{copy.tabTitle} · {copy.tabYou} <span data-testid="tab-total">{total}</span></h2>
  <div class="grid">
    {#each DRINK_KINDS as kind (kind)}
      <button type="button" class:clink={clinking === kind} disabled={!stopId} onclick={() => snap(kind)} data-testid="drink-{kind}">
        <span class="icon" aria-hidden="true">{drinkIcons[kind]}</span>
        {#if sending.includes(kind)}<span class="name sending" data-testid="tab-sending-{kind}">{copy.tabSending}</span>
        {:else}<span class="name">{(copy as Record<string, string>)[`drink_${kind}`]}</span>{/if}
        <span class="count">{counts.mine[kind]}</span>
      </button>
    {/each}
  </div>
  <input bind:this={camera} type="file" accept="image/*" capture="environment" hidden onchange={picked} oncancel={() => (choosing = null)} data-testid="tab-camera" />
  {#if !stopId}<p class="closed">{copy.tabClosed}</p>
  {:else}
    <p class="hint">{copy.tabProofHint}</p>
    {#if showUndoLast && counts.lastMine}
      <button type="button" class="undo-last" onclick={() => onundo(counts.lastMine!)} data-testid="tab-undo-last">{copy.undoLast}</button>
    {/if}
  {/if}
</section>

<style>
  .tab { padding: 6px 0 12px; }
  h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .grid button { margin: 0; padding: 10px 2px; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: 1px;
    background: linear-gradient(145deg, #443319, #211b13); color: #ffe3a3; border: 1px solid #b5873b; box-shadow: 0 3px 0 #695024; }
  .grid button:active { transform: translateY(2px); box-shadow: none; }
  .grid button:disabled { opacity: .45; box-shadow: none; }
  .icon { font-size: 26px; line-height: 1.2; }
  .name { font-size: 10.5px; font-weight: 600; opacity: .85; }
  .count { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .clink .icon { animation: clink .4s ease-out; }
  @keyframes clink { 30% { transform: rotate(-18deg) scale(1.25); } 60% { transform: rotate(10deg); } }
  @media (prefers-reduced-motion: reduce) { .clink .icon { animation: none; } }
  .sending { color: #ffb400; opacity: 1; }
  .closed { margin: 8px 0 0; font-size: 14px; }
  .hint { margin: 8px 0 0; font-size: 13px; color: #aaa; }
  .undo-last { width: auto; min-height: 32px; margin: 8px 0 0; padding: 4px 10px; font-size: 13px; background: none; color: #aaa;
    border: 0; text-decoration: underline; font-weight: 600; }
</style>
