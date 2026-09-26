// The Departure Board's state machine. Pure, with `now` injected, so M4's sim clock drives it
// without changing a line here.
import type { Leg, NextTrip, Stop } from '$lib/types';

/** Minutes of slack between arriving on the platform and the train leaving. */
export const BUFFER_MIN = 3;
/** How far out the first warning (Last Call) appears. */
export const WARNING_MIN = 10;

export type BoardState = 'normal' | 'warning' | 'leave_now' | 'missed';
export type Board = { state: BoardState; leaveAt: Date; departsInMin: number };

export function boardState(opts: { departAt: Date; walkMin: number; now: Date }): Board {
  const leaveAt = new Date(opts.departAt.getTime() - (opts.walkMin + BUFFER_MIN) * 60_000);
  const departsInMin = Math.round((leaveAt.getTime() - opts.now.getTime()) / 60_000);
  const state: BoardState =
    opts.now.getTime() > opts.departAt.getTime() ? 'missed'
    : departsInMin > WARNING_MIN ? 'normal'
    : departsInMin > 0 ? 'warning'
    : 'leave_now';
  return { state, leaveAt, departsInMin };
}

/**
 * The trip the board counts down to: the planned one while it has not left, otherwise the first
 * trip that has not left yet. Before the crawl the plan names the train; counting down to an
 * earlier one would start the crew on the wrong train.
 */
export function pickTrip(trips: NextTrip[], now: Date, plannedTripId?: string | null): NextTrip | null {
  const catchable = (t: NextTrip) => new Date(t.liveDepart ?? t.schedDepart).getTime() > now.getTime();
  const planned = plannedTripId ? trips.find((t) => t.tripId === plannedTripId && catchable(t)) : undefined;
  return planned ?? trips.find(catchable) ?? null;
}

/** The first train the plan takes from `stationId`, in stop order, or null when it takes none. */
export function plannedTrain(stops: Stop[], legs: Leg[], stationId: string): { tripId: string; dep: string } | null {
  const order = new Map(stops.map((s) => [s.id, s.order]));
  const ordered = [...legs].sort((a, b) => (order.get(a.from_stop) ?? 0) - (order.get(b.from_stop) ?? 0));
  for (const leg of ordered) {
    for (const seg of leg.segments ?? []) {
      if (seg.kind === 'train' && seg.from === stationId) return { tripId: seg.tripId, dep: seg.dep };
    }
  }
  return null;
}
