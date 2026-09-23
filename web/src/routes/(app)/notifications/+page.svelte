<script lang="ts">
  // Service alerts from Metra, and (from M3) Bulletins from the Conductor. Opening the screen marks
  // every alert on it as seen, which clears the header dot.
  import { clientClock } from '$lib/sim/clock.svelte';
  import { copy } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  import { fetchAlerts } from '$lib/live/feed';
  import { markSeen, readSeen } from '$lib/live/seen';
  import { liveDay } from '$lib/live/day.svelte';
  import type { Alert } from '$lib/types';

  let alerts = $state<Alert[]>([]);
  let seen = $state<Set<string>>(new Set());
  let loaded = $state(false);

  $effect(() => {
    seen = readSeen();
    if (clientClock.enabled) { alerts = liveDay.alerts; markSeen(alerts.map(a => a.id)); loaded = true; return; }
    void fetchAlerts()
      .then((r) => { alerts = r.alerts; markSeen(r.alerts.map((a) => a.id)); })
      .catch(() => { alerts = []; })
      .finally(() => { loaded = true; });
  });
</script>

<svelte:head><title>{copy.notifications}</title></svelte:head>

<p><a href="/live">← {copy.backToLive}</a></p>
<h1>{copy.notifications}</h1>

<h2>{copy.serviceAlerts}</h2>
{#if loaded && alerts.length === 0}
  <p>{copy.noNotifications}</p>
{/if}
{#each alerts as alert (alert.id)}
  <article class="notice" class:unread={!seen.has(alert.id)}>
    <div class="row">
      <span class="title">{alert.header}</span>
      <span class="when">{alert.startsAt ? `${copy.effectiveAt} ${fmtDateTime(alert.startsAt)}` : copy.notificationTimeUnknown}</span>
    </div>
    {#if alert.body}<p class="body">{alert.body}</p>{/if}
  </article>
{/each}

<h2>{copy.bulletins}</h2>
{#if liveDay.bulletins.length === 0}<p>{copy.bulletinsLater}</p>{/if}
<div data-testid="bulletin-list">
  {#each liveDay.bulletins as bulletin (bulletin.id)}
    <article class="notice">
      <div class="row"><span class="title">{copy.fromTheConductor}</span><span class="when">{copy.postedAt} {fmtDateTime(bulletin.at || bulletin.created)}</span></div>
      <p class="body">{bulletin.body}</p>
    </article>
  {/each}
</div>

<style>
  h2 { margin: 24px 0 8px; font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .notice { padding: 15px 0; border-bottom: 1px solid #2a2a2a; }
  .notice.unread { background: rgba(255,180,0,.05); }
  .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .title { flex-grow: 1; font-size: 15.5px; font-weight: 700; }
  .when { flex: none; font-size: 12px; color: #9a9a9a; }
  .body { margin: 4px 0 0; font-size: 14px; line-height: 1.45; color: #b4b4b4; }
</style>
