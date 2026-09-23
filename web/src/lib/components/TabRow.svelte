<script lang="ts">
  // One tap per drink at the stop the crawl is in. Personal counts only.
  import { copy, drinkIcons } from '$lib/labels';
  import { DRINK_KINDS, tally } from '$lib/live/tab';
  import type { DrinkEntry, DrinkKind } from '$lib/types';
  let { entries, stopId, userId, onlog, onundo }: {
    entries: DrinkEntry[]; stopId: string; userId: string;
    onlog: (kind: DrinkKind) => void; onundo: (entry: DrinkEntry) => void;
  } = $props();
  const counts = $derived(tally(entries, stopId, userId));
</script>

<section class="tab">
  <h2>{copy.tabTitle}</h2>
  <div class="grid">
    {#each DRINK_KINDS as kind (kind)}
      <button type="button" onclick={() => onlog(kind)} data-testid="drink-{kind}">
        <span class="icon" aria-hidden="true">{drinkIcons[kind]}</span>
        <span class="name">{(copy as Record<string, string>)[`drink_${kind}`]}</span>
        <span class="count">{counts.mine[kind]}</span>
      </button>
    {/each}
  </div>
  {#if counts.lastMine}
    <button type="button" class="secondary" onclick={() => onundo(counts.lastMine!)} data-testid="tab-undo">{copy.undoDrink}</button>
  {/if}
</section>

<style>
  .tab { padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .grid button { position: relative; margin: 0; padding: 12px 8px; display: flex; flex-direction: column; gap: 2px;
    background: #1b1b1b; color: #eee; border: 1px solid #333; }
  .name { font-size: 13px; color: #aaa; font-weight: 600; }
  .count { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .icon { font-size: 28px; }
</style>
