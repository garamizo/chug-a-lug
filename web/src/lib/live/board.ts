// The Departure Board's state machine. Pure, with `now` injected, so M4's sim clock drives it
// without changing a line here.
import type { Current } from './current';
import type { Itinerary, Leg, NextTrip, Stop } from '$lib/types';

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
  // The opening leg's `from_stop` is '', not a stop id: it must sort before every real stop.
  const rank = (id: string) => (id ? order.get(id) ?? 0 : -Infinity);
  const ordered = [...legs].sort((a, b) => rank(a.from_stop) - rank(b.from_stop));
  for (const leg of ordered) {
    for (const seg of leg.segments ?? []) {
      if (seg.kind === 'train' && seg.from === stationId) return { tripId: seg.tripId, dep: seg.dep };
    }
  }
  return null;
}

export type Boarding = { from: string; fromName: string; to: string; toName: string; walkMin: 0; planned: { tripId: string; dep: string } };

/**
 * Before the crawl, the ride the crew actually starts with: from the route's start station to stop 1.
 * Null when the route has no start station, stop 1 is at it, the opening leg has no train, or the
 * crawl has begun — then the board follows the stops as it always has.
 */
export function boardingJourney(itinerary: Pick<Itinerary, 'start_station' | 'start_station_name'> | null, stops: Stop[], legs: Leg[], here: Current | null): Boarding | null {
  if (!itinerary?.start_station || here?.source !== 'before') return null;
  const first = [...stops].sort((a, b) => a.order - b.order)[0];
  if (!first || first.station_id === itinerary.start_station) return null;
  const opening = legs.find((l) => !l.from_stop && l.to_stop === first.id);
  const train = opening?.segments?.find((seg) => seg.kind === 'train');
  if (!opening || opening.kind !== 'train' || !train || train.kind !== 'train') return null;
  return {
    from: itinerary.start_station, fromName: itinerary.start_station_name || itinerary.start_station,
    to: first.station_id, toName: first.station_name || first.station_id, walkMin: 0,
    planned: { tripId: train.tripId, dep: train.dep }
  };
}
