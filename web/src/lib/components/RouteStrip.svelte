<script lang="ts">
  // The whole crawl as a line of stops: punched, here, still ahead. Any stop opens its sheet.
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import type { StripStop } from '$lib/live/strip';
  let { items, onopen }: { items: StripStop[]; onopen: (id: string) => void } = $props();
  let track = $state<HTMLOListElement>();
  const currentId = $derived(items.find((i) => i.state === 'current')?.stop.id);
  $effect(() => {
    const id = currentId;
    if (track && id) track.querySelector(`[data-stop="${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
</script>

<nav aria-label={copy.routeProgress}>
  <ol class="strip" bind:this={track} data-testid="route-strip">
    {#each items as item, i (item.stop.id)}
      <li class={item.state} data-stop={item.stop.id}>
        <button type="button" onclick={() => onopen(item.stop.id)} data-testid="strip-stop-{i}"
          aria-current={item.state === 'current' ? 'step' : undefined}>
          <span class="dot" aria-hidden="true">{item.state === 'done' ? '✓' : item.state === 'current' ? '🚂' : ''}</span>
          <span class="name">{item.stop.name}</span>
          <span class="at">{item.arriveAt ? fmtTime(item.arriveAt) : ''}</span>
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .strip { display: flex; list-style: none; margin: 0; padding: 8px 16px 4px; overflow-x: auto; scrollbar-width: none; }
  li { flex: 0 0 96px; position: relative; }
  li::before { content: ''; position: absolute; top: 21px; left: 0; right: 0; height: 3px; background: #3a3a3a; }
  li:first-child::before { left: 50%; } li:last-child::before { right: 50%; }
  li.done::before { background: #b5873b; }
  button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 100%;
    min-height: 0; margin: 0; padding: 4px 2px; background: none; border: 0; color: #aaa; font-size: 12px; font-weight: 600; }
  .dot { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; border: 3px solid #555; background: #111; font-size: 14px; color: #111; }
  .done .dot { background: #b5873b; border-color: #b5873b; }
  .current .dot { background: #ffb400; border-color: #ffb400; width: 36px; height: 36px; margin-top: -3px; font-size: 18px; }
  .current button { color: #fff; }
  .name { max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .at { font-variant-numeric: tabular-nums; color: #777; font-size: 11px; }
</style>
