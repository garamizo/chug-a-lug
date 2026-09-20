// Which stop the crawl is at. Derived from the clock over the locked itinerary's legs, with the
// Conductor's correction winning while it is newer than the arrival the clock would pick. No GPS:
// browsers cannot track location with the screen off, and a clock is something everyone can check.
import type { Leg, Stop } from '$lib/types';

export type CurrentSource = 'override' | 'clock' | 'before' | 'after';
export type Current = {
  stop: Stop | null;
  /** The stop after this one, or null at the end of the crawl. */
  nextStop: Stop | null;
  /** When the crawl leaves `stop`, or null when nothing follows. */
  departAt: string | null;
  source: CurrentSource;
};

type Timing = { stop: Stop; arriveAt: number; departAt: number | null; next: Stop | null; departIso: string | null };

/** Arrival and departure per stop: the incoming leg's arrival (or the start) and the outgoing leg's departure. */
function timings(stops: Stop[], legs: Leg[], startAt: Date): Timing[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const incoming = new Map(legs.map((l) => [l.to_stop, l]));
  const outgoing = new Map(legs.map((l) => [l.from_stop, l]));
  return ordered.map((stop, i) => {
    const inLeg = incoming.get(stop.id);
    const outLeg = outgoing.get(stop.id);
    const arriveIso = i === 0 ? startAt.toISOString() : inLeg?.arrive_at;
    return {
      stop,
      arriveAt: arriveIso ? new Date(arriveIso).getTime() : startAt.getTime(),
      departAt: outLeg?.depart_at ? new Date(outLeg.depart_at).getTime() : null,
      departIso: outLeg?.depart_at ?? null,
      next: ordered[i + 1] ?? null
    };
  });
}

const result = (t: Timing, source: CurrentSource): Current =>
  ({ stop: t.stop, nextStop: t.next, departAt: t.departIso, source });

export function currentStop(
  stops: Stop[],
  legs: Leg[],
  now: Date,
  opts: { startAt: Date; override?: { stopId: string; at: string } | null }
): Current {
  const ts = timings(stops, legs, opts.startAt);
  if (ts.length === 0) return { stop: null, nextStop: null, departAt: null, source: 'before' };

  const at = now.getTime();
  const last = ts[ts.length - 1];

  // Walk forward to the last stop the crawl has already arrived at.
  let picked = ts[0];
  let source: CurrentSource = 'before';
  for (const t of ts) {
    if (at < t.arriveAt) break;
    picked = t;
    source = 'clock';
  }
  // The crawl is over once it is past the final departure, or — since the last stop has no onward
  // leg — once it has arrived there at all. Either way there is no train left to catch.
  if (picked === last && (last.departAt === null ? at >= last.arriveAt : at >= last.departAt)) source = 'after';

  const override = opts.override;
  if (override) {
    const hit = ts.find((t) => t.stop.id === override.stopId);
    // A correction holds until the schedule catches up with it; an older one is a leftover.
    if (hit && new Date(override.at).getTime() > picked.arriveAt) return result(hit, 'override');
  }
  return result(picked, source);
}
