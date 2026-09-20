import { describe, expect, it } from 'vitest';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { selectAlerts } from '../../src/lib/server/metra/decode';
import { alertEntity, encodeFeed } from '../fixtures/rt';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const decode = (b: Uint8Array) => FeedMessage.decode(b);
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = new Date('2026-12-26T20:00:00Z');
const STATIONS = new Set(['LAGRANGE', 'BERWYN', 'CUS']);
const opts = { routeId: 'BNSF', stationIds: STATIONS, now: NOW };

describe('selectAlerts', () => {
  it('keeps an alert informing our route and reads its text', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a1', header: 'Delays', body: 'Signal problem', effect: 2 })], 1));
    expect(selectAlerts(feed, opts)).toEqual([
      { id: 'a1', effect: 'SIGNIFICANT_DELAYS', header: 'Delays', body: 'Signal problem', startsAt: null, endsAt: null, stationIds: [] }
    ]);
  });

  it('keeps an alert informing one of our stations and lists it', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a2', header: 'Elevator', informed: [{ stopId: 'CUS' }] })], 1));
    const [a] = selectAlerts(feed, opts);
    expect(a.stationIds).toEqual(['CUS']);
  });

  it('drops an alert for another route', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a3', header: 'Other', informed: [{ routeId: 'UP-W' }] })], 1));
    expect(selectAlerts(feed, opts)).toEqual([]);
  });

  it('keeps an agency-wide alert', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a4', header: 'Holiday schedule', informed: [{ agencyId: 'metra' }] })], 1));
    expect(selectAlerts(feed, opts)).toHaveLength(1);
  });

  it('drops an alert whose active period has not started or has ended', () => {
    const feed = decode(encodeFeed([
      alertEntity({ id: 'future', header: 'Later', activeStart: sec('2026-12-26T22:00:00Z') }),
      alertEntity({ id: 'past', header: 'Earlier', activeEnd: sec('2026-12-26T19:00:00Z') }),
      alertEntity({ id: 'now', header: 'Current', activeStart: sec('2026-12-26T19:30:00Z'), activeEnd: sec('2026-12-26T21:00:00Z') })
    ], 1));
    expect(selectAlerts(feed, opts).map((a) => a.id)).toEqual(['now']);
  });

  it('returns nothing for a missing feed', () => {
    expect(selectAlerts(null, opts)).toEqual([]);
  });
});
