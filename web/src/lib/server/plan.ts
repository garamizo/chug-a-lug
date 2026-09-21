// The one path from stops to leg times, shared by recompute, the preview endpoint and the commit
// endpoint: whatever the editor previews is exactly what a save writes.
import { error } from '@sveltejs/kit';
import type PocketBase from 'pocketbase';
import { metra } from './metra';
import { recomputeLegs } from '$lib/metra/plan';
import { localToUtc, minutesOfDay, todayInTz } from '$lib/time';
import type { Checkin, Segment } from '$lib/types';

export type PlanStop = { id: string; order: number; station_id: string; dwell_min: number; walk_min: number };
export type PlannedLeg = {
  fromStopId: string; toStopId: string; kind: 'train' | 'walk' | 'impossible';
  readyAt: string; departAt: string; arriveAt: string; segments: Segment[];
};

const VENUE_KINDS = new Set(['bar', 'restaurant', 'other']);

/**
 * The stop shape the planner needs, validated so a malformed editor state cannot reach the planner.
 * Shared by the preview endpoint (a dry run) and the commit endpoint (the real write).
 *
 * `checkVenueFields` additionally requires `name` and `kind` — fields the planner itself never reads,
 * but which the commit endpoint must persist. Checked here, before commit does anything else, so a
 * malformed stop is rejected before the first delete runs rather than partway through the write.
 */
export function readStops(value: unknown, opts?: { checkVenueFields?: boolean }): PlanStop[] {
  if (!Array.isArray(value) || value.length === 0) throw error(400, 'Send the stops to plan.');
  return value.map((raw) => {
    const s = raw as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const stop = {
      id: String(s.id ?? ''), order: num(s.order), station_id: String(s.station_id ?? ''),
      dwell_min: num(s.dwell_min), walk_min: num(s.walk_min)
    };
    if (!stop.id || !stop.station_id || Number.isNaN(stop.order) || Number.isNaN(stop.dwell_min) || Number.isNaN(stop.walk_min)) {
      throw error(400, 'Each stop needs an id, a station and its minutes.');
    }
    if (opts?.checkVenueFields) {
      if (!String(s.name ?? '').trim()) throw error(400, 'Each stop needs a name.');
      if (!VENUE_KINDS.has(String(s.kind ?? ''))) throw error(400, 'Each stop needs a kind of bar, restaurant, or other.');
    }
    return stop;
  });
}

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

/**
 * The anchor only steers the planner on the event's own day. `at` is a real timestamp — the moment
 * someone clicked "set here" — and `computeLegs` turns it into minutes since the *event date's*
 * midnight via `minutesOfDay`. Off-day (a Conductor opening The Route a week early to fix a bar that
 * closed) that timestamp is nowhere near the event date's midnight, so it comes out as a huge,
 * meaningless offset, and the schedule search it feeds effectively picks whichever trip happens to
 * be earliest that day — unrelated to where the check-in was actually made. Off-day an itinerary
 * plans from `start_time` instead, exactly like a draft: `recomputeItinerary`, `/api/plan/preview`
 * and `/api/plan/commit` all call this rather than deciding it three separate ways, or a preview
 * could disagree with what a save then does. The `checkins` row itself is still written either way;
 * this only decides whether the planner reads it.
 */
export function activeAnchor(
  eventDate: string,
  anchor: { stopId: string; at: string } | null,
  now: Date = new Date()
): { stopId: string; at: string } | null {
  return anchor && eventDate === todayInTz(now) ? anchor : null;
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
