// Which stop the crawl is at. Derived from the clock over the locked itinerary's legs, with the
// Conductor's check-in as the floor the clock moves on from. No GPS:
// browsers cannot track location with the screen off, and a clock is something everyone can check.
import type { Leg, Stop } from '$lib/types';

export type CurrentSource = 'override' | 'clock' | 'before' | 'after';
export type Current = {
  stop: Stop | null;
  /** The stop after this one, or null at the end of the crawl. */
  nextStop: Stop | null;
  /**
   * The next stop at a *different* station: where the train is actually headed. With several venues
   * at one station this is not `nextStop`, and asking the timetable for a trip from a station to
   * itself returns nothing, which would read as "no train left today" for the whole layover.
   */
  onwardStop: Stop | null;
  /** When the crawl leaves `stop`, or null when nothing follows. */
  departAt: string | null;
  source: CurrentSource;
};

type Timing = {
  stop: Stop; arriveAt: number; departAt: number | null; departIso: string | null;
  next: Stop | null; onward: Stop | null;
};

/** Arrival and departure per stop: the incoming leg's arrival (or the start) and the outgoing leg's departure. */
function timings(stops: Stop[], legs: Leg[], startAt: Date): Timing[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const incoming = new Map(legs.map((l) => [l.to_stop, l]));
  const outgoing = new Map(legs.map((l) => [l.from_stop, l]));
  return ordered.map((stop, i) => {
    const inLeg = incoming.get(stop.id);
    const outLeg = outgoing.get(stop.id);
    const arriveIso = inLeg?.arrive_at ?? (i === 0 ? startAt.toISOString() : undefined);
    return {
      stop,
      arriveAt: arriveIso ? new Date(arriveIso).getTime() : startAt.getTime(),
      departAt: outLeg?.depart_at ? new Date(outLeg.depart_at).getTime() : null,
      departIso: outLeg?.depart_at ?? null,
      next: ordered[i + 1] ?? null,
      onward: ordered.slice(i + 1).find((s) => s.station_id !== stop.station_id) ?? null
    };
  });
}

const result = (t: Timing, source: CurrentSource): Current =>
  ({ stop: t.stop, nextStop: t.next, onwardStop: t.onward, departAt: t.departIso, source });

export function currentStop(
  stops: Stop[],
  legs: Leg[],
  now: Date,
  opts: { startAt: Date; override?: { stopId: string; at: string } | null }
): Current {
  const ts = timings(stops, legs, opts.startAt);
  if (ts.length === 0) return { stop: null, nextStop: null, onwardStop: null, departAt: null, source: 'before' };

  const at = now.getTime();
  const last = ts[ts.length - 1];
  // The crawl is over once it is past the final departure, or — since the last stop has no onward
  // leg — once it has arrived there at all. Either way there is no train left to catch.
  const finished = (t: Timing) => t === last && (t.departAt === null ? at >= t.arriveAt : at >= t.departAt);

  const override = opts.override;
  const hit = override ? ts.findIndex((t) => t.stop.id === override.stopId) : -1;
  if (override && hit >= 0) {
    // The Conductor's check-in is where the crew is. Recompute replans every leg after it from that
    // moment and keeps the ones before it as history, so the clock only moves the crawl on from the
    // checked-in stop: a history arrival that is still ahead cannot drag it back. A later stop whose
    // arrival is no later than the check-in comes from legs not yet replanned from it, so it is
    // skipped rather than counted as reached. A check-in from an earlier day never gets here: callers
    // gate it with `anchorOnEventDay`.
    const checkedIn = new Date(override.at).getTime();
    let i = hit;
    for (let j = hit + 1; j < ts.length; j++) {
      if (ts[j].arriveAt <= checkedIn) continue;
      if (at < ts[j].arriveAt) break;
      i = j;
    }
    if (i > hit) return result(ts[i], finished(ts[i]) ? 'after' : 'clock');
    // Still at the checked-in stop. At the last stop, a check-in no newer than its planned arrival
    // is one the schedule has caught up with, so the crawl ends there as it would by the clock.
    const t = ts[hit];
    return result(t, finished(t) && checkedIn <= t.arriveAt ? 'after' : 'override');
  }

  // Walk forward to the last stop the crawl has already arrived at.
  let picked = ts[0];
  let source: CurrentSource = 'before';
  for (const t of ts) {
    if (at < t.arriveAt) break;
    picked = t;
    source = 'clock';
  }
  if (finished(picked)) source = 'after';
  return result(picked, source);
}
