// Turns decoded GTFS-realtime feeds into the plain data the pure merge works on. Everything that
// knows about protobuf shapes lives here.
import type { FeedMessage } from './realtime';
import type { Predictions } from '$lib/metra/live';

/** GTFS-realtime ScheduleRelationship.CANCELED on a TripDescriptor. */
const CANCELED = 3;

const iso = (t: unknown): string | undefined => {
  // protobufjs gives Long for 64-bit fields; Number() handles both it and a plain number.
  const n = t === null || t === undefined ? NaN : Number(t);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
};

/** Predicted times per trip and stop, for `routeId` only. A missing feed yields no predictions. */
export function readPredictions(feed: FeedMessage | null, routeId: string): Predictions {
  const out: Predictions = {};
  for (const entity of feed?.entity ?? []) {
    const tu = entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;
    if (tu.trip?.routeId && tu.trip.routeId !== routeId) continue;
    const pred = out[tripId] ?? (out[tripId] = { canceled: false, stops: {} });
    if (tu.trip?.scheduleRelationship === CANCELED) pred.canceled = true;
    for (const stu of tu.stopTimeUpdate ?? []) {
      if (!stu.stopId) continue;
      const at = pred.stops[stu.stopId] ?? (pred.stops[stu.stopId] = {});
      const departAt = iso(stu.departure?.time);
      const arriveAt = iso(stu.arrival?.time);
      if (departAt) at.departAt = departAt;
      if (arriveAt) at.arriveAt = arriveAt;
    }
  }
  return out;
}
