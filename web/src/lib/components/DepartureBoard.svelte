<script lang="ts">
  // The Departure Board: a ticket for the run the crawl has to catch. The whole card changes colour
  // at Last Call and All Aboard so it registers without being read.
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { boardState } from '$lib/live/board';
  import { boardTone, leadLine } from '$lib/live/present';
  import type { FeedMode, NextTrip } from '$lib/types';

  let { station, stopName, nextStation, trip, walkMin, now, mode, rtFetchedAt, canCorrect, oncorrect }: {
    station: string; stopName: string; nextStation: string;
    trip: NextTrip | null; walkMin: number; now: Date;
    mode: FeedMode; rtFetchedAt: string | null;
    canCorrect: boolean; oncorrect: () => void;
  } = $props();

  const stale = $derived(mode !== 'live');
  // Stale means the predictions are not trustworthy, so show the timetable and say so.
  const departIso = $derived(trip ? (stale ? trip.schedDepart : trip.liveDepart ?? trip.schedDepart) : null);
  const arriveIso = $derived(trip ? (stale ? trip.schedArrive : trip.liveArrive ?? trip.schedArrive) : null);
  const board = $derived(departIso ? boardState({ departAt: new Date(departIso), walkMin, now }) : null);
  const tone = $derived(board ? boardTone(board.state) : 'calm');
</script>

<div class="wrap">
  <div class="card {tone}" data-testid="departure-board">
    {#if trip && board && departIso && arriveIso}
      <div class="head">
        <span class="agency">{copy.metraBnsf}</span>
        <span class="run">{copy.run} {trip.tripId}</span>
      </div>
      <h2 class="station">{station}</h2>
      <div class="times">
        <div>
          <div class="cap">{copy.departLabel}</div>
          <div class="clock">{fmtTime(departIso)}</div>
          <div class="where">{station}</div>
        </div>
        <div>
          <div class="cap">{copy.arriveLabel}</div>
          <div class="clock">{fmtTime(arriveIso)}</div>
          <div class="where">{nextStation}</div>
        </div>
      </div>
      {#if stale}
        <p class="stale" data-testid="timetable-only">
          {#if rtFetchedAt}{copy.timetableOnly} {fmtTime(rtFetchedAt)}{:else}{copy.timetableOnlyNoTime}{/if}
        </p>
      {/if}
      <div class="lead">
        <div class="big">{leadLine(board.state, board.departsInMin)}</div>
        <div class="sub">
          {#if board.state === 'leave_now'}{copy.leaveNowSub} ·
          {:else if board.state === 'warning'}{copy.leaveIn} {Math.max(0, board.departsInMin)} {copy.minutes} ·
          {/if}
          {walkMin} {copy.walkFrom} {stopName}
        </div>
      </div>
    {:else}
      <h2 class="station">{station}</h2>
      <p class="lead"><span class="big">{copy.noTrainLeft}</span></p>
    {/if}
    {#if canCorrect}
      <button type="button" class="correct" onclick={oncorrect} data-testid="set-our-stop">{copy.setOurStop}</button>
    {/if}
  </div>
</div>

<style>
  .wrap { padding: 12px 16px 16px; }
  .card { border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; }
  .calm { background: #f2efe6; color: #141413; --faint: #6b6862; --rule: #c9c4b5; --edge: #c0bbac; }
  .last { background: #ffb400; color: #111; --faint: rgba(17,17,17,.72); --rule: rgba(0,0,0,.28); --edge: rgba(0,0,0,.3); }
  .aboard { background: #c0261c; color: #fff; --faint: rgba(255,255,255,.82); --rule: rgba(0,0,0,.28); --edge: rgba(0,0,0,.3); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
  .head .agency { font-weight: 700; }
  .head .run { color: var(--faint); }
  .station { margin: 0; font-size: 25px; font-weight: 750; line-height: 1.15; }
  .times { display: flex; gap: 18px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .times > div { flex-grow: 1; }
  .cap { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
  .clock { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .where { font-size: 12px; color: var(--faint); }
  .stale { margin: 0; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--rule);
    background: rgba(20,20,19,.07); font-size: 12px; line-height: 1.35; color: inherit; }
  .lead { border-top: 1px dashed var(--rule); padding-top: 13px; margin: 0; }
  .big { font-size: 24px; font-weight: 800; line-height: 1.1; }
  .aboard .big { font-size: 27px; }
  .sub { font-size: 13px; margin-top: 4px; color: var(--faint); }
  .correct { font-size: 14px; font-weight: 600; padding: 10px 14px; min-height: 44px; width: 100%;
    border-radius: 9px; border: 1px solid var(--edge); background: transparent; color: inherit; margin: 0; }
</style>
