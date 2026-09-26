<script lang="ts">
  let { kicker, title, when, countdown, href, testid }: { kicker: string; title: string; when?: string; countdown?: string | null; href: string; testid?: string } = $props();
</script>

<a class="ticket" {href} data-testid={testid}>
  <span class="k">{kicker}</span>
  <strong class="t">{title}</strong>
  {#if when || countdown}<span class="row"><span>{when}</span>{#if countdown}<span class="count">{countdown}</span>{/if}</span>{/if}
</a>

<style>
  .ticket { position: relative; display: block; color: #1a1406; text-decoration: none; border-radius: 14px; padding: 14px 18px;
    margin: 12px 0 14px; background: linear-gradient(135deg, #ffcf4a, var(--gold, #ffb400)); box-shadow: 0 6px 0 var(--gold-deep, #6b4c10); }
  .ticket:active { transform: translateY(3px); box-shadow: 0 3px 0 var(--gold-deep, #6b4c10); }
  .ticket::before, .ticket::after { content: ''; position: absolute; top: 58%; width: 20px; height: 20px; border-radius: 50%; background: #111; }
  .ticket::before { left: -10px; } .ticket::after { right: -10px; }
  .k { display: block; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 800; opacity: .7; }
  .t { display: block; font-size: 24px; font-weight: 900; margin: 2px 0 10px; overflow-wrap: anywhere; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-top: 2px dashed rgba(0,0,0,.35);
    padding-top: 8px; font-size: 13px; font-weight: 800; text-transform: uppercase; }
  .count { font-size: 24px; font-weight: 900; text-transform: none; }
</style>
