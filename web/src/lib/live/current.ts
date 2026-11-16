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

export type CrawlEnd = { at: Date; reason?: undefined } | { at: null; reason: 'no_run_home' };

const lastStop = (stops: Stop[]): Stop | null =>
  stops.reduce<Stop | null>((m, s) => (m === null || s.order > m.order ? s : m), null);

/** The run home: from the last stop, to nowhere (`to_stop` empty), heading for "Board at". */
export function closingLeg(stops: Stop[], legs: Leg[]): Leg | null {
  const last = lastStop(stops);
  return last ? legs.find((l) => l.from_stop === last.id && l.to_stop === '') ?? null : null;
}

/** When the crawl is over: the train home's arrival; null when no run home is possible. Without a
 *  closing leg (older data) it is the last stop's departure if it has one, else its arrival. */
export function crawlEnd(stops: Stop[], legs: Leg[], startAt: Date): CrawlEnd {
  const last = lastStop(stops);
  if (!last) return { at: startAt };
  const closing = closingLeg(stops, legs);
  if (closing) {
    return closing.kind === 'impossible' ? { at: null, reason: 'no_run_home' } : { at: new Date(closing.arrive_at) };
  }
  const out = legs.find((l) => l.from_stop === last.id);
  if (out?.depart_at) return { at: new Date(out.depart_at) };
  const arrive = legs.find((l) => l.to_stop === last.id)?.arrive_at;
  return { at: arrive ? new Date(arrive) : startAt };
}

/** True when the closing leg was planned from this check-in: its ready_at is within 60 s of
 *  check-in + last.dwell_min (what `recomputeLegs` produces from that anchor). Always true with no
 *  anchor or an anchor at another stop. */
export function closingFresh(stops: Stop[], legs: Leg[], anchor: { stopId: string; at: string } | null): boolean {
  const last = lastStop(stops);
  if (!anchor || !last || anchor.stopId !== last.id) return true;
  const closing = closingLeg(stops, legs);
  if (!closing) return true;
  const expected = new Date(anchor.at).getTime() + last.dwell_min * 60_000;
  return Math.abs(new Date(closing.ready_at).getTime() - expected) <= 60_000;
}

/** A plan-clock instant on the activity clock. `shiftMs` is `now - realNow` (0 on the event day), and activity
 *  is stamped with real time, so plan times are moved back by it. Closing Time and the reel's stop windows share it. */
export const toActivityClock = (planMs: number, shiftMs: number): string => new Date(planMs - shiftMs).toISOString();

export type Timing = {
  stop: Stop; arriveAt: number; departAt: number | null; departIso: string | null;
  next: Stop | null; onward: Stop | null;
};

/** Arrival and departure per stop: the incoming leg's arrival (or the start) and the outgoing leg's departure. */
export function stopTimings(stops: Stop[], legs: Leg[], startAt: Date): Timing[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const incoming = new Map(legs.filter((l) => l.to_stop !== '').map((l) => [l.to_stop, l]));
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
  const ts = stopTimings(stops, legs, opts.startAt);
  if (ts.length === 0) return { stop: null, nextStop: null, onwardStop: null, departAt: null, source: 'before' };

  const at = now.getTime();
  const last = ts[ts.length - 1];
  // The crawl is over once the train home has arrived. With no run home (impossible) it never ends.
  const end = crawlEnd(stops, legs, opts.startAt);
  const finished = (t: Timing) => t === last && end.at !== null && at >= end.at.getTime();

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
    // Still at the checked-in stop. At the last stop the crawl ends when the train home arrives, but
    // only if that leg was replanned from this check-in; stale legs say nothing about it.
    const t = ts[hit];
    if (t !== last) return result(t, 'override');
    const closing = closingLeg(stops, legs);
    if (!closing) return result(t, finished(t) && checkedIn <= t.arriveAt ? 'after' : 'override');
    const done = closing.kind !== 'impossible' && closingFresh(stops, legs, override) && finished(t);
    return result(t, done ? 'after' : 'override');
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
