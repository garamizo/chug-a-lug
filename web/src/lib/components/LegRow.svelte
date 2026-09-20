<script lang="ts">
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import type { Leg } from '$lib/types';

  let { leg, index, names }: { leg: Leg | undefined; index: number; names: Record<string, string> } = $props();
  const name = (id: string) => names[id] ?? id;
</script>

{#if !leg}
  <p class="leg muted" data-testid="leg-{index}">{copy.computing}</p>
{:else if leg.kind === 'impossible'}
  <p class="leg bad" data-testid="leg-{index}">{copy.noTrain}</p>
{:else if leg.kind === 'walk'}
  {@const minutes = leg.segments[0]?.kind === 'walk' ? leg.segments[0].minutes : 0}
  <p class="leg" data-testid="leg-{index}">{minutes ? `${copy.walk} ${minutes} ${copy.minutes}` : copy.sameStation}</p>
{:else}
  <ol class="leg" data-testid="leg-{index}">
    {#each leg.segments as seg}
      {#if seg.kind === 'train'}
        <li><span class="route">{seg.routeId}</span> {copy.departs} <strong>{fmtTime(seg.dep)}</strong> {name(seg.from)} → {copy.arrives} <strong>{fmtTime(seg.arr)}</strong> {name(seg.to)}</li>
      {:else}
        <li class="muted">{copy.walk} {seg.minutes} {copy.minutes}, {copy.changeAt} {name(seg.to)}</li>
      {/if}
    {/each}
  </ol>
{/if}

<style>
  .leg { margin: 0; padding: 10px 0 10px 22px; border-left: 3px dashed #555; font-size: 15px; color: #ccc; }
  ol.leg { list-style: none; }
  li + li { margin-top: 6px; }
  .route { display: inline-block; padding: 1px 8px; border-radius: 6px; background: #333; font-weight: 700; font-size: 13px; }
  .bad { color: #ff9a9a; border-left-color: #ff5a5a; }
  .muted { color: #999; }
</style>
