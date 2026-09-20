// Protobuf fixtures built with the same bindings the server decodes with, so unit tests need no
// token and no network. Task 13 adds a test over bytes captured from the real feed.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

/** Wraps entities in a FeedMessage and returns the encoded bytes. */
export function encodeFeed(entity: unknown[], timestampSec: number): Uint8Array {
  return FeedMessage.encode(FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp: timestampSec },
    entity
  })).finish();
}

/** One TripUpdate entity. `stops` maps stopId to seconds-since-epoch departure and arrival. */
export function tripUpdate(opts: {
  id: string; tripId: string; routeId?: string; canceled?: boolean;
  stops?: { stopId: string; departure?: number; arrival?: number }[];
}) {
  return {
    id: opts.id,
    tripUpdate: {
      trip: { tripId: opts.tripId, routeId: opts.routeId ?? 'BNSF', scheduleRelationship: opts.canceled ? 3 : 0 },
      stopTimeUpdate: (opts.stops ?? []).map((s) => ({
        stopId: s.stopId,
        ...(s.arrival === undefined ? {} : { arrival: { time: s.arrival } }),
        ...(s.departure === undefined ? {} : { departure: { time: s.departure } })
      }))
    }
  };
}

/** One Alert entity. `informed` is a list of informed_entity objects. */
export function alertEntity(opts: {
  id: string; header: string; body?: string; effect?: number;
  activeStart?: number; activeEnd?: number; informed?: Record<string, unknown>[];
}) {
  return {
    id: opts.id,
    alert: {
      activePeriod: opts.activeStart === undefined && opts.activeEnd === undefined ? [] : [{
        ...(opts.activeStart === undefined ? {} : { start: opts.activeStart }),
        ...(opts.activeEnd === undefined ? {} : { end: opts.activeEnd })
      }],
      informedEntity: opts.informed ?? [{ routeId: 'BNSF' }],
      effect: opts.effect ?? 2,
      headerText: { translation: [{ text: opts.header, language: 'en' }] },
      descriptionText: opts.body ? { translation: [{ text: opts.body, language: 'en' }] } : { translation: [] }
    }
  };
}
