<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Chip } from '$lib/home';
  let { href, icon, title, subtitle, chip, testid, index = 0, actions }: {
    href?: string; icon?: string; title: string; subtitle?: string; chip?: Chip; testid?: string; index?: number; actions?: Snippet;
  } = $props();
</script>

<div class="row" role="listitem">
  {#if icon}<span class="ic" aria-hidden="true">{icon}</span>{/if}
  <div class="body">
    {#if href}<a {href} class="t flip" style:animation-delay="{index * 60}ms" data-testid={testid}>{title}</a>
    {:else}<span class="t flip off" style:animation-delay="{index * 60}ms" data-testid={testid}>{title}</span>{/if}
    {#if subtitle}<small>{subtitle}</small>{/if}
    {#if actions}<div class="acts">{@render actions()}</div>{/if}
  </div>
  {#if chip}<span class="chip {chip.tone}">{chip.text}</span>{/if}
</div>

<style>
  .row { position: relative; display: flex; gap: 10px; align-items: center; padding: 12px; border-top: 1px solid #222; }
  .ic { font-size: 22px; width: 28px; text-align: center; }
  .body { flex: 1; min-width: 0; }
  .t { display: block; font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 17px; font-weight: 700;
    color: var(--gold-soft, #ffce5c); text-transform: uppercase; text-decoration: none; overflow-wrap: anywhere;
    animation: flip .35s ease-out both; transform-origin: top; }
  a.t::after { content: ''; position: absolute; inset: 0; } /* whole row is the tap target */
  .acts { position: relative; z-index: 1; display: flex; gap: 6px; margin-top: 8px; }
  .acts:empty { display: none; }
  .t.off { color: #777; }
  small { display: block; color: #999; font-size: 13px; margin-top: 2px; }
  .chip { font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; font-weight: 800; padding: 4px 7px;
    border-radius: 4px; text-transform: uppercase; white-space: nowrap; }
  .go { background: var(--metra, #29C233); color: #031; }
  .gold { background: var(--gold, #ffb400); color: #111; }
  .muted { background: #2a2a2a; color: #888; }
  .red { background: #c0261c; color: #fff; }
</style>
