// Shared planner result conversion, usable by both the server and rehearsal preparation.
import { recomputeLegs, type StopInput } from './plan.ts';
import { localToUtc, minutesOfDay } from '../time.ts';
import type { Schedule } from './gtfs.ts';
import type { Segment } from '../types.ts';
export function computeLegs(schedule: Schedule, opts: {
  date: string; startMin: number; anchor?: { stopId: string; at: string } | null; stops: StopInput[];
}) {
  const anchor = opts.anchor ? { stopId: opts.anchor.stopId, atMin: minutesOfDay(opts.date, opts.anchor.at) } : null;
  const toIso = (m: number) => localToUtc(opts.date, m).toISOString();
  return recomputeLegs(schedule, { date: opts.date, startMin: opts.startMin, anchor }, opts.stops).map((leg) => ({
    fromStopId: leg.fromStopId, toStopId: leg.toStopId, kind: leg.kind,
    readyAt: toIso(leg.readyMin), departAt: toIso(leg.departMin), arriveAt: toIso(leg.arriveMin),
    segments: leg.segments.map((seg) => (seg.kind === 'train' ? { ...seg, dep: toIso(seg.dep), arr: toIso(seg.arr) } : seg)) as Segment[]
  }));
}
