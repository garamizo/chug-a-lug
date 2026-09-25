<script lang="ts">
  // The whole crawl as a line of stops: punched, here, still ahead. Any stop opens its sheet.
  // Each stop owns half of the link on either side: a plain line for a walk, track for a train.
  import { copy, venueIcons } from '$lib/labels';
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
        {#if item.arriveBy}<span class="link in {item.arriveBy}" class:passed={item.state !== 'next'} aria-hidden="true"></span>{/if}
        {#if item.leaveBy}<span class="link out {item.leaveBy}" class:passed={item.state === 'done'} aria-hidden="true"></span>{/if}
        <button type="button" onclick={() => onopen(item.stop.id)} data-testid="strip-stop-{i}"
          data-arrive={item.arriveBy} data-leave={item.leaveBy}
          aria-current={item.state === 'current' ? 'step' : undefined}>
          <span class="dot" aria-hidden="true">{venueIcons[item.stop.kind] ?? ''}</span>
          <span class="name">{item.stop.name}</span>
          <span class="at">{item.arriveAt ? fmtTime(item.arriveAt) : ''}</span>
        </button>
      </li>
    {/each}
  </ol>
</nav>

<style>
  .strip { display: flex; list-style: none; margin: 0; padding: 8px 0 4px; overflow-x: auto; scrollbar-width: none; }
  li { flex: 0 0 96px; position: relative; }
  .link { --c: #3a3a3a; position: absolute; top: 21px; height: 3px; background: var(--c); }
  .link.passed { --c: #b5873b; }
  .in { left: 0; right: 50%; } .out { left: 50%; right: 0; }
  /* Track: two rails with sleepers between them. */
  .link.train { top: 17px; height: 11px; background:
    linear-gradient(var(--c) 0 2px, transparent 2px 9px, var(--c) 9px) ,
    repeating-linear-gradient(90deg, var(--c) 0 3px, transparent 3px 8px) 0 2px / 100% 7px no-repeat; }
  button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 100%;
    min-height: 0; margin: 0; padding: 4px 2px; background: none; border: 0; color: #aaa; font-size: 12px; font-weight: 600; }
  .dot { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; border: 3px solid #555; background: #111; font-size: 14px; }
  .done .dot { background: #b5873b; border-color: #b5873b; }
  .current .dot { background: #ffb400; border-color: #ffb400; width: 36px; height: 36px; margin-top: -3px; font-size: 18px; }
  .current button { color: #fff; }
  .name { max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The stop the crew is at reads as the headline: wider slot, bigger name, up to two lines. */
  li.current { flex-basis: 140px; }
  .current .name { max-width: 136px; font-size: 16px; font-weight: 750; line-height: 1.2; color: #ffce5c;
    white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .at { font-variant-numeric: tabular-nums; color: #777; font-size: 11px; }
</style>
