// Turns decoded GTFS-realtime feeds into the plain data the pure merge works on. Everything that
// knows about protobuf shapes lives here.
import type { FeedMessage } from './realtime';
import type { Predictions } from '$lib/metra/live';
import type { Alert } from '$lib/types';

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

/** GTFS-realtime Alert.Effect, by enum value. */
const EFFECTS = [
  'NO_SERVICE', 'REDUCED_SERVICE', 'SIGNIFICANT_DELAYS', 'DETOUR', 'ADDITIONAL_SERVICE',
  'MODIFIED_SERVICE', 'OTHER_EFFECT', 'UNKNOWN_EFFECT', 'STOP_MOVED', 'NO_EFFECT', 'ACCESSIBILITY_ISSUE'
];

/** First English translation, else the first of any language, else ''. */
type Translated = { translation?: { text?: string | null; language?: string | null }[] | null } | null | undefined;
const text = (t: Translated): string => {
  const all = t?.translation ?? [];
  return (all.find((x) => x.language === 'en') ?? all[0])?.text ?? '';
};

/**
 * Active alerts that inform our route, one of our stations, or the whole agency. An alert with no
 * active_period is always active, which is what the spec says an absent period means.
 */
export function selectAlerts(
  feed: FeedMessage | null,
  opts: { routeId: string; stationIds: Set<string>; now: Date }
): Alert[] {
  const nowSec = Math.floor(opts.now.getTime() / 1000);
  const out: Alert[] = [];
  for (const entity of feed?.entity ?? []) {
    const al = entity.alert;
    if (!al) continue;

    const periods = al.activePeriod ?? [];
    const active = periods.length === 0 || periods.some((p) => {
      const start = p.start === null || p.start === undefined ? -Infinity : Number(p.start);
      const end = p.end === null || p.end === undefined ? Infinity : Number(p.end);
      return nowSec >= start && nowSec <= end;
    });
    if (!active) continue;

    const informed = al.informedEntity ?? [];
    const stationIds = informed.map((e) => e.stopId).filter((id): id is string => !!id && opts.stationIds.has(id));
    const relevant = informed.some((e) =>
      e.routeId === opts.routeId ||
      (!!e.stopId && opts.stationIds.has(e.stopId)) ||
      (!e.routeId && !e.stopId && !e.trip));
    if (!relevant) continue;

    const first = periods[0];
    const at = (v: unknown) => (v === null || v === undefined ? null : new Date(Number(v) * 1000).toISOString());
    out.push({
      id: entity.id ?? '',
      effect: EFFECTS[al.effect ?? 7] ?? 'UNKNOWN_EFFECT',
      header: text(al.headerText),
      body: text(al.descriptionText),
      startsAt: at(first?.start),
      endsAt: at(first?.end),
      stationIds: [...new Set(stationIds)]
    });
  }
  return out;
}
