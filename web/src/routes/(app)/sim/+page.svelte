<script lang="ts">
  import { auth } from '$lib/pb';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { CLOCK_RATES, type ClockCommand } from '$lib/sim/clock';
  import { labels, copy } from '$lib/labels';
  import { localToUtc, fmtDateTime } from '$lib/time';
  let time = $state('');
  let error = $state('');
  let busy = $state(false);
  async function change(command: ClockCommand) {
    busy = true; error = '';
    try { await clientClock.control(command); }
    catch (err) { error = (err as Error).message; }
    finally { busy = false; }
  }
  function seek() {
    const [h, m] = time.split(':').map(Number);
    if (!clientClock.sample || !Number.isFinite(h) || !Number.isFinite(m)) { error = copy.simInvalidControl; return; }
    void change({ action: 'seek', at: localToUtc(clientClock.sample.serviceDate, h * 60 + m).toISOString() });
  }
</script>
<svelte:head><title>{labels.simulationMode}</title></svelte:head>
<h1>{labels.simulationMode}</h1>
{#if !clientClock.enabled}<p>{copy.simDisabled}</p>
{:else if !$auth.user?.is_admin}<p>{copy.simAdminOnly}</p>
{:else if clientClock.sample}
  <p>{clientClock.sample.serviceDate} · {clientClock.sample.source === 'recording' ? copy.simRecorded : copy.simTimetable}</p>
  <p>{copy.simWindow}: {fmtDateTime(clientClock.sample.windowStart)} – {fmtDateTime(clientClock.sample.windowEnd)}</p>
  <button disabled={busy || clientClock.sample.ended} onclick={() => change({ action: clientClock.sample?.rate ? 'pause' : 'resume' })} data-testid="sim-toggle">{clientClock.sample.rate ? copy.simPause : copy.simResume}</button>
  <div class="rates" aria-label={copy.simSpeed}>
    {#each CLOCK_RATES as rate}<button class="secondary" aria-pressed={clientClock.sample.resumeRate === rate} disabled={busy} onclick={() => change({ action: 'rate', rate })}>{rate}×</button>{/each}
  </div>
  <label>{copy.simForwardTime}<input type="time" bind:value={time} /></label>
  <button disabled={busy || clientClock.sample.rate !== 0 || !time} onclick={seek}>{copy.simSeek}</button>
{/if}
{#if error}<p role="alert">{error}</p>{/if}
<style>.rates { display: flex; flex-wrap: wrap; gap: 8px; } .rates button { width: auto; flex: 1; } [aria-pressed="true"] { outline: 2px solid #ffb400; }</style>
