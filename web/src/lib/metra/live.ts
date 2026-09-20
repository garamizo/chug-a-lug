// Pure: merging predicted times onto scheduled ones, choosing which departures to offer, and
// deciding how much to trust them.
import type { FeedMode, NextTrip } from '$lib/types';

/** Four missed polls. One constant so the field test can tune it. */
export const STALE_AFTER_SEC = 120;

/**
 * How far before the caller's `after` to look for candidate trips. A train can be running late, and a
 * late train has not departed: drawing candidates only from `after` onwards would hide one still standing
 * at the platform. Metra delays past an hour are rare, and the scan costs about a millisecond.
 */
export const DELAY_LOOKBACK_MIN = 60;

export type StopPrediction = { departAt?: string; arriveAt?: string };
export type TripPrediction = { canceled: boolean; stops: Record<string, StopPrediction> };
export type Predictions = Record<string, TripPrediction>;

const minutesBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60_000);

/**
 * Overlays predictions on scheduled trips for one leg. A trip with no prediction is on time, which
 * is what Metra's absence of a TripUpdate means. A cancelled trip is dropped so the caller rolls on.
 */
export function mergeLive(trips: NextTrip[], preds: Predictions, fromStopId: string, toStopId: string): NextTrip[] {
  const out: NextTrip[] = [];
  for (const t of trips) {
    const pred = preds[t.tripId];
    if (pred?.canceled) continue;
    const liveDepart = pred?.stops[fromStopId]?.departAt ?? t.schedDepart;
    const liveArrive = pred?.stops[toStopId]?.arriveAt ?? t.schedArrive;
    out.push({
      ...t, liveDepart, liveArrive,
      delayMin: minutesBetween(liveDepart, t.schedDepart),
      status: pred ? 'live' : 'scheduled'
    });
  }
  return out;
}

const effective = (t: NextTrip) => new Date(t.liveDepart ?? t.schedDepart).getTime();

/**
 * Merge first, then filter, then sort, then cut. Every step after the merge depends on the effective
 * departure, so doing any of them earlier throws away trips that are still catchable: a delayed train
 * filtered out by its scheduled time, or good service cut off behind three cancellations.
 */
export function selectDepartures(
  candidates: NextTrip[],
  preds: Predictions,
  fromStopId: string,
  toStopId: string,
  after: Date,
  limit: number
): NextTrip[] {
  return mergeLive(candidates, preds, fromStopId, toStopId)
    .filter((t) => effective(t) >= after.getTime())
    .sort((a, b) => effective(a) - effective(b))
    .slice(0, limit);
}

/** `live` while that feed's last successful fetch is recent, `stale` once it is not, else `schedule_only`. */
export function modeFor(status: { ageSec: number | null; enabled: boolean }): FeedMode {
  if (!status.enabled || status.ageSec === null) return 'schedule_only';
  return status.ageSec <= STALE_AFTER_SEC ? 'live' : 'stale';
}
