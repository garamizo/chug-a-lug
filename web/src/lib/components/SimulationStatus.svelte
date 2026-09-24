<script lang="ts">
  // The rehearsal marker in the app header: one line with Railroad Time. The run's details (source,
  // speed, state, sync) ride along as the tooltip so the header stays a single line on a phone.
  import { clientClock } from '$lib/sim/clock.svelte';
  import { liveDay } from '$lib/live/day.svelte';
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  const sample = $derived(clientClock.sample);
  const status = $derived(!sample ? copy.simUnavailable : [
    sample.source === 'recording' ? copy.simRecorded : copy.simTimetable,
    `${sample.rate || sample.resumeRate}×`,
    liveDay.realNow.getTime() >= Date.parse(sample.windowEnd) ? copy.simEnded : sample.rate === 0 ? copy.simPaused : copy.simRunning,
    clientClock.synchronized ? copy.simSynced : copy.simUnsynced
  ].join(' · '));
</script>
{#if clientClock.enabled}
  <small data-testid="rehearsal-badge">{copy.rehearsalTitle}{#if sample}{' — '}<time datetime={liveDay.realNow.toISOString()} data-testid="simulation-status" data-status={status} title={status}>{fmtTime(liveDay.realNow)}{#if !clientClock.synchronized} <span class="warn" aria-label={copy.simUnsynced}>⚠</span>{/if}</time>{/if}</small>
{/if}
<style>
  small { display: block; color: #ffb400; font-size: 12px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; }
  time { color: #fff; font-weight: 800; font-variant-numeric: tabular-nums; }
  .warn { color: #ff9a9a; }
</style>
