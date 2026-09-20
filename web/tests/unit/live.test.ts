import { describe, expect, it } from 'vitest';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { readPredictions } from '../../src/lib/server/metra/decode';
import { mergeLive, modeFor, selectDepartures, STALE_AFTER_SEC } from '../../src/lib/metra/live';
import { encodeFeed, tripUpdate } from '../fixtures/rt';
import type { NextTrip } from '../../src/lib/types';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const decode = (b: Uint8Array) => FeedMessage.decode(b);
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const trip = (tripId: string, dep: string, arr: string): NextTrip => ({
  tripId, routeId: 'BNSF', headsign: 'Chicago', schedDepart: dep, schedArrive: arr,
  liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled'
});

describe('readPredictions', () => {
  it('reads departures and arrivals per trip and stop, for our route only', () => {
    const feed = decode(encodeFeed([
      tripUpdate({ id: 'a', tripId: 'T1', stops: [{ stopId: 'LAGRANGE', departure: sec('2026-12-26T20:34:00Z'), arrival: sec('2026-12-26T20:33:00Z') }] }),
      tripUpdate({ id: 'b', tripId: 'T9', routeId: 'UP-W', stops: [{ stopId: 'LAGRANGE', departure: sec('2026-12-26T20:40:00Z') }] })
    ], 1));
    const preds = readPredictions(feed, 'BNSF');
    expect(preds.T1.stops.LAGRANGE.departAt).toBe('2026-12-26T20:34:00.000Z');
    expect(preds.T1.stops.LAGRANGE.arriveAt).toBe('2026-12-26T20:33:00.000Z');
    expect(preds.T9).toBeUndefined();
  });

  it('marks a cancelled trip and survives a missing feed', () => {
    const feed = decode(encodeFeed([tripUpdate({ id: 'c', tripId: 'T2', canceled: true })], 1));
    expect(readPredictions(feed, 'BNSF').T2.canceled).toBe(true);
    expect(readPredictions(null, 'BNSF')).toEqual({});
  });
});

describe('mergeLive', () => {
  const trips = [trip('T1', '2026-12-26T20:31:00.000Z', '2026-12-26T20:46:00.000Z')];

  it('treats a trip with no update as on time', () => {
    const [t] = mergeLive(trips, {}, 'LAGRANGE', 'BERWYN');
    expect(t.liveDepart).toBe('2026-12-26T20:31:00.000Z');
    expect(t.liveArrive).toBe('2026-12-26T20:46:00.000Z');
    expect(t.delayMin).toBe(0);
    expect(t.status).toBe('scheduled');
  });

  it('applies a predicted departure and arrival and reports the delay in minutes', () => {
    const preds = { T1: { canceled: false, stops: {
      LAGRANGE: { departAt: '2026-12-26T20:34:00.000Z' },
      BERWYN: { arriveAt: '2026-12-26T20:49:00.000Z' }
    } } };
    const [t] = mergeLive(trips, preds, 'LAGRANGE', 'BERWYN');
    expect(t.liveDepart).toBe('2026-12-26T20:34:00.000Z');
    expect(t.liveArrive).toBe('2026-12-26T20:49:00.000Z');
    expect(t.delayMin).toBe(3);
    expect(t.status).toBe('live');
  });

  it('falls back to the scheduled time for a stop the update does not mention', () => {
    const preds = { T1: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T20:34:00.000Z' } } } };
    const [t] = mergeLive(trips, preds, 'LAGRANGE', 'BERWYN');
    expect(t.liveArrive).toBe('2026-12-26T20:46:00.000Z');
  });

  it('reports a train running early as a negative delay', () => {
    const preds = { T1: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T20:29:00.000Z' } } } };
    expect(mergeLive(trips, preds, 'LAGRANGE', 'BERWYN')[0].delayMin).toBe(-2);
  });

  it('drops a cancelled trip entirely', () => {
    const preds = { T1: { canceled: true, stops: {} } };
    expect(mergeLive(trips, preds, 'LAGRANGE', 'BERWYN')).toEqual([]);
  });
});

describe('selectDepartures', () => {
  const after = new Date('2026-12-26T20:35:00.000Z');
  const candidates = [
    trip('T1', '2026-12-26T20:31:00.000Z', '2026-12-26T20:46:00.000Z'), // late, still catchable
    trip('T2', '2026-12-26T21:00:00.000Z', '2026-12-26T21:15:00.000Z'),
    trip('T3', '2026-12-26T22:00:00.000Z', '2026-12-26T22:15:00.000Z'),
    trip('T4', '2026-12-26T23:00:00.000Z', '2026-12-26T23:15:00.000Z')
  ];

  it('keeps a train delayed past its scheduled departure', () => {
    // Scheduled 20:31, predicted 20:41. At 20:35 it has not left.
    const preds = { T1: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T20:41:00.000Z' } } } };
    const out = selectDepartures(candidates, preds, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out[0].tripId).toBe('T1');
    expect(out[0].liveDepart).toBe('2026-12-26T20:41:00.000Z');
  });

  it('drops a train that has really gone', () => {
    const out = selectDepartures(candidates, {}, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out.map((t) => t.tripId)).toEqual(['T2', 'T3', 'T4']);
  });

  it('does not let cancellations empty the board', () => {
    const cancel = { canceled: true, stops: {} };
    const preds = { T1: cancel, T2: cancel, T3: cancel };
    const out = selectDepartures(candidates, preds, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out.map((t) => t.tripId)).toEqual(['T4']);
  });

  it('sorts by effective departure, not scheduled', () => {
    // T2 is held 90 minutes, so T3 overtakes it.
    const preds = { T2: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T22:30:00.000Z' } } } };
    const out = selectDepartures(candidates, preds, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out.map((t) => t.tripId)).toEqual(['T3', 'T2', 'T4']);
  });

  it('applies the limit last', () => {
    const out = selectDepartures(candidates, {}, 'LAGRANGE', 'BERWYN', after, 2);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.tripId)).toEqual(['T2', 'T3']);
  });

  it('returns nothing when the service day is over', () => {
    expect(selectDepartures(candidates, {}, 'LAGRANGE', 'BERWYN', new Date('2026-12-27T02:00:00.000Z'), 3)).toEqual([]);
  });
});

describe('modeFor', () => {
  it('is schedule_only without a token or before the first successful fetch', () => {
    expect(modeFor({ ageSec: null, enabled: false })).toBe('schedule_only');
    expect(modeFor({ ageSec: null, enabled: true })).toBe('schedule_only');
  });
  it('is live up to the threshold and stale past it', () => {
    expect(modeFor({ ageSec: 0, enabled: true })).toBe('live');
    expect(modeFor({ ageSec: STALE_AFTER_SEC, enabled: true })).toBe('live');
    expect(modeFor({ ageSec: STALE_AFTER_SEC + 1, enabled: true })).toBe('stale');
  });
});
