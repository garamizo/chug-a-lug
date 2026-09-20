// Turns decoded GTFS-realtime feeds into the plain data the pure merge works on. Everything that
// knows about protobuf shapes lives here.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
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

/**
 * Predicted times per trip and stop, for `routeId` only. A missing feed yields no predictions.
 *
 * `serviceDate` (YYYY-MM-DD) keeps a trip only when the feed says it is running that day. Metra's
 * trip ids repeat weekly, so without this a Saturday's live updates would be pinned onto the next
 * Saturday's timetable: the absolute times would read as long departed and the board would empty
 * itself. A trip carrying no start date is kept, since there is nothing to contradict.
 */
export function readPredictions(feed: FeedMessage | null, routeId: string, serviceDate?: string): Predictions {
  const wanted = serviceDate?.replace(/-/g, '');
  const out: Predictions = {};
  for (const entity of feed?.entity ?? []) {
    const tu = entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;
    if (tu.trip?.routeId && tu.trip.routeId !== routeId) continue;
    if (wanted && tu.trip?.startDate && tu.trip.startDate !== wanted) continue;
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

/**
 * Alert.Effect by value, taken from the bindings rather than hand-written: the enum runs 1..11
 * (NO_SERVICE is 1, not 0), so any zero-based table mislabels every effect by one.
 */
const EFFECT_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(GtfsRealtimeBindings.transit_realtime.Alert.Effect).map(([name, value]) => [value, name])
);

/** protobufjs serves absent scalars from the prototype, so only an own property was really sent. */
const sent = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

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
      // An absent `end` decodes to Long(0). Reading that as a timestamp would retire every
      // open-ended alert in 1970, so presence is checked before the value is interpreted.
      const start = sent(p, 'start') ? Number(p.start) : -Infinity;
      const end = sent(p, 'end') ? Number(p.end) : Infinity;
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
    const at = (p: object | undefined, key: 'start' | 'end') =>
      p && sent(p, key) ? new Date(Number((p as Record<string, unknown>)[key]) * 1000).toISOString() : null;
    out.push({
      id: entity.id ?? '',
      effect: (sent(al, 'effect') && EFFECT_NAMES[al.effect as number]) || 'UNKNOWN_EFFECT',
      header: text(al.headerText),
      body: text(al.descriptionText),
      startsAt: at(first, 'start'),
      endsAt: at(first, 'end'),
      stationIds: [...new Set(stationIds)]
    });
  }
  return out;
}
