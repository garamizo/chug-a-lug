<script lang="ts">
  import { clientClock } from '$lib/sim/clock.svelte';
  import { liveDay } from '$lib/live/day.svelte';
  import { copy, labels } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
</script>
{#if clientClock.enabled}
  <aside data-testid="simulation-status" aria-live="polite">
    <strong>{copy.rehearsalTitle}</strong>
    {#if clientClock.sample}
      <time datetime={liveDay.now.toISOString()} data-testid="rehearsal-time">{labels.simulationClock}: {fmtDateTime(liveDay.now.toISOString())}</time>
      <span>{clientClock.sample.source === 'recording' ? copy.simRecorded : copy.simTimetable} · {clientClock.sample.rate || clientClock.sample.resumeRate}× · {liveDay.now.getTime() >= Date.parse(clientClock.sample.windowEnd) ? copy.simEnded : clientClock.sample.rate === 0 ? copy.simPaused : copy.simRunning} · {clientClock.synchronized ? copy.simSynced : copy.simUnsynced}</span>
    {:else}<span>{copy.simUnavailable}</span>{/if}
  </aside>
{/if}
<style>
  aside { margin: 4px 0; padding: 6px 10px; border: 1px solid #ffb400; border-radius: 8px; font-size: 11px; display: grid; gap: 2px; }
  time { font-size: 15px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
  strong { color: #ffb400; }
</style>
