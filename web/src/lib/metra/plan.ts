// Pure trip planning over the static schedule. Minutes are since the service day's midnight.
import { DOWNTOWN, servicesOn, type Schedule } from './gtfs';

export type Connection = { tripId: string; routeId: string; headsign: string; from: string; to: string; dep: number; arr: number };
export type PlanSegment = ({ kind: 'train' } & Connection) | { kind: 'walk'; minutes: number; from: string; to: string };
/**
 * One station-to-station hop. `departMin` is when you leave `from`: the first train's departure,
 * or — when the hop starts with a walk between the downtown terminals — the minute the walk starts
 * (the at-station time the caller passed in). `arriveMin` is the arrival at the destination
 * station, after a trailing downtown walk if there is one.
 */
export type LegPlan = { kind: 'train' | 'walk' | 'impossible'; segments: PlanSegment[]; departMin: number; arriveMin: number };
export type StopInput = { id: string; order: number; station_id: string; dwell_min: number; walk_min: number };
export type ComputedLeg = { fromStopId: string; toStopId: string; kind: LegPlan['kind']; readyMin: number; departMin: number; arriveMin: number; segments: PlanSegment[] };

export const DOWNTOWN_WALK_MIN = 6;

/** Trips serving `from` then `to` (in that order) departing at or after `afterMin` on `date`. */
export function nextTrips(s: Schedule, from: string, to: string, afterMin: number, date: string, limit = 3): Connection[] {
  if (from === to) return [];
  const active = servicesOn(s, date);
  const out: Connection[] = [];
  for (const t of s.trips) {
    if (!active.has(t.serviceId)) continue;
    const a = t.stops.findIndex((x) => x.stopId === from);
    if (a < 0) continue;
    const b = t.stops.findIndex((x) => x.stopId === to);
    if (b <= a) continue;
    const dep = t.stops[a].dep;
    if (dep < afterMin) continue;
    out.push({ tripId: t.id, routeId: t.routeId, headsign: t.headsign, from, to, dep, arr: t.stops[b].arr });
  }
  out.sort((x, y) => x.dep - y.dep || x.arr - y.arr);
  return out.slice(0, limit);
}

function walk(from: string, to: string, minutes: number, atStationMin: number): LegPlan {
  return { kind: 'walk', segments: [{ kind: 'walk', minutes, from, to }], departMin: atStationMin, arriveMin: atStationMin + minutes };
}

/**
 * Station to station. Five shapes, in the order they are considered; the earliest arrival wins and
 * a tie keeps the simpler plan:
 *  - a walk: the same station (0 min), or the downtown pair OTC <-> Union (6 min);
 *  - one direct train;
 *  - train then walk: no train reaches a downtown destination, so ride to the OTHER downtown
 *    terminal and walk the 6 minutes across;
 *  - walk then train: leaving one downtown terminal for a line that starts at the other one;
 *  - train, downtown walk, train: a transfer between two lines.
 * `atStationMin` is the minute you are physically at (or ready to leave from) `from` — callers
 * such as recomputeLegs pass the venue's ready time plus its walk-to-station time.
 */
export function planLeg(s: Schedule, from: string, to: string, atStationMin: number, date: string): LegPlan {
  if (from === to) return walk(from, to, 0, atStationMin);
  if (DOWNTOWN.has(from) && DOWNTOWN.has(to)) return walk(from, to, DOWNTOWN_WALK_MIN, atStationMin);
  let best: LegPlan | null = null;
  const consider = (plan: LegPlan) => { if (!best || plan.arriveMin < best.arriveMin) best = plan; };

  const direct = nextTrips(s, from, to, atStationMin, date, 1)[0];
  if (direct) consider({ kind: 'train', segments: [{ kind: 'train', ...direct }], departMin: direct.dep, arriveMin: direct.arr });

  // Train to the other downtown terminal, then the 6-minute walk across.
  if (DOWNTOWN.has(to)) {
    for (const d of DOWNTOWN) {
      if (d === to || d === from) continue;
      const c = nextTrips(s, from, d, atStationMin, date, 1)[0];
      if (!c) continue;
      consider({
        kind: 'train',
        segments: [{ kind: 'train', ...c }, { kind: 'walk', minutes: DOWNTOWN_WALK_MIN, from: d, to }],
        departMin: c.dep, arriveMin: c.arr + DOWNTOWN_WALK_MIN
      });
    }
  }

  // Walk across downtown first, then ride out from the other terminal; departMin is the walk start.
  if (DOWNTOWN.has(from)) {
    for (const d of DOWNTOWN) {
      if (d === from || d === to) continue;
      const c = nextTrips(s, d, to, atStationMin + DOWNTOWN_WALK_MIN, date, 1)[0];
      if (!c) continue;
      consider({
        kind: 'train',
        segments: [{ kind: 'walk', minutes: DOWNTOWN_WALK_MIN, from, to: d }, { kind: 'train', ...c }],
        departMin: atStationMin, arriveMin: c.arr
      });
    }
  }

  for (const d1 of DOWNTOWN) {
    for (const d2 of DOWNTOWN) {
      if (d1 === from || d2 === to) continue;
      const c1 = nextTrips(s, from, d1, atStationMin, date, 1)[0];
      if (!c1) continue;
      const hop = d1 === d2 ? 0 : DOWNTOWN_WALK_MIN;
      const c2 = nextTrips(s, d2, to, c1.arr + hop, date, 1)[0];
      if (!c2) continue;
      const segments: PlanSegment[] = [{ kind: 'train', ...c1 }];
      if (hop) segments.push({ kind: 'walk', minutes: hop, from: d1, to: d2 });
      segments.push({ kind: 'train', ...c2 });
      consider({ kind: 'train', segments, departMin: c1.dep, arriveMin: c2.arr });
    }
  }
  return best ?? { kind: 'impossible', segments: [], departMin: atStationMin, arriveMin: atStationMin };
}

/** Walk the itinerary: at stop 1 at startMin, dwell, walk to the station, ride, walk to the next venue. */
export function recomputeLegs(s: Schedule, opts: { date: string; startMin: number }, stops: StopInput[]): ComputedLeg[] {
  const sorted = [...stops].sort((a, b) => a.order - b.order);
  const legs: ComputedLeg[] = [];
  let arrival = opts.startMin;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    const readyMin = arrival + a.dwell_min;
    const atStation = readyMin + a.walk_min;
    const plan = planLeg(s, a.station_id, b.station_id, atStation, opts.date);
    const arriveMin = (plan.kind === 'impossible' ? atStation : plan.arriveMin) + b.walk_min;
    legs.push({ fromStopId: a.id, toStopId: b.id, kind: plan.kind, readyMin, departMin: plan.departMin, arriveMin, segments: plan.segments });
    arrival = arriveMin;
  }
  return legs;
}
