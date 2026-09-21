// The one path from stops to leg times, shared by recompute, the preview endpoint and the commit
// endpoint: whatever the editor previews is exactly what a save writes.
import type PocketBase from 'pocketbase';
import { metra } from './metra';
import { recomputeLegs } from '$lib/metra/plan';
import { localToUtc, minutesOfDay } from '$lib/time';
import type { Checkin, Segment } from '$lib/types';

export type PlanStop = { id: string; order: number; station_id: string; dwell_min: number; walk_min: number };
export type PlannedLeg = {
  fromStopId: string; toStopId: string; kind: 'train' | 'walk' | 'impossible';
  readyAt: string; departAt: string; arriveAt: string; segments: Segment[];
};

/**
 * The anchor: the newest check-in written by a Conductor for this itinerary. The Crew never writes
 * `checkins` in M3, but an old row from a non-admin (or from the admin UI) must not steer the day,
 * so the reader filters on the expanded user rather than trusting the collection.
 */
export async function findAnchor(pb: PocketBase, itineraryId: string): Promise<{ stopId: string; at: string } | null> {
  const rows = await pb.collection('checkins').getList<Checkin>(1, 20, {
    filter: pb.filter('kind = "at_stop" && stop.itinerary = {:id}', { id: itineraryId }),
    sort: '-at',
    expand: 'user'
  });
  const hit = rows.items.find((c) => c.expand?.user?.is_admin && c.stop);
  return hit ? { stopId: hit.stop, at: hit.at } : null;
}

/** Leg times for a set of stops, in UTC. Pure apart from reading the cached GTFS schedule. */
export async function computeLegs(opts: {
  date: string; startMin: number; anchor?: { stopId: string; at: string } | null; stops: PlanStop[];
}): Promise<PlannedLeg[]> {
  const schedule = await metra.getSchedule();
  const anchor = opts.anchor ? { stopId: opts.anchor.stopId, atMin: minutesOfDay(opts.date, opts.anchor.at) } : null;
  const toIso = (m: number) => localToUtc(opts.date, m).toISOString();
  return recomputeLegs(schedule, { date: opts.date, startMin: opts.startMin, anchor }, opts.stops).map((leg) => ({
    fromStopId: leg.fromStopId,
    toStopId: leg.toStopId,
    kind: leg.kind,
    readyAt: toIso(leg.readyMin),
    departAt: toIso(leg.departMin),
    arriveAt: toIso(leg.arriveMin),
    segments: leg.segments.map((seg) => (seg.kind === 'train' ? { ...seg, dep: toIso(seg.dep), arr: toIso(seg.arr) } : seg)) as Segment[]
  }));
}
