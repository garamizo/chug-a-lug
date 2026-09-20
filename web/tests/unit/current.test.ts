import { describe, expect, it } from 'vitest';
import { currentStop } from '../../src/lib/live/current';
import type { Leg, Stop } from '../../src/lib/types';

const stop = (id: string, station: string, order: number): Stop => ({
  id, itinerary: 'i1', order, name: id, kind: 'bar', station_id: station, station_name: station,
  place: '', place_id: '', osm_id: '', address: '', lat: 0, lon: 0, hours: null, phone: '', website: '',
  confirmed_open: false, dwell_min: 60, walk_min: 5, notes: '', meet_point: '', photos_status: 'none',
  direction: 'out', collectionId: 'c', collectionName: 'stops', created: '', updated: ''
} as Stop);

const leg = (from: string, to: string, depart: string, arrive: string): Leg => ({
  id: `${from}-${to}`, itinerary: 'i1', from_stop: from, to_stop: to, kind: 'train',
  ready_at: depart, depart_at: depart, arrive_at: arrive, segments: [], computed_at: '',
  collectionId: 'c', collectionName: 'legs', created: '', updated: ''
} as Leg);

// A crawl: A (from 12:00), train to B at 13:00 arriving 13:20, train to C at 15:00 arriving 15:20.
const stops = [stop('A', 'AURORA', 1), stop('B', 'LAGRANGE', 2), stop('C', 'CUS', 3)];
const legs = [
  leg('A', 'B', '2026-12-26T19:00:00.000Z', '2026-12-26T19:20:00.000Z'),
  leg('B', 'C', '2026-12-26T21:00:00.000Z', '2026-12-26T21:20:00.000Z')
];
const startAt = new Date('2026-12-26T18:00:00.000Z');
const at = (iso: string) => currentStop(stops, legs, new Date(iso), { startAt });

describe('currentStop', () => {
  it('is the first stop, marked before, ahead of the start', () => {
    const r = at('2026-12-26T17:00:00.000Z');
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('before');
  });

  it('is the stop whose arrival has passed and whose departure has not', () => {
    const r = at('2026-12-26T18:30:00.000Z');
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('clock');
    expect(r.nextStop?.id).toBe('B');
    expect(r.departAt).toBe('2026-12-26T19:00:00.000Z');
  });

  it('moves on once the next arrival has passed', () => {
    expect(at('2026-12-26T20:00:00.000Z').stop?.id).toBe('B');
  });

  it('stays at the stop it left while the train is still running', () => {
    // Departed A at 19:00, arrives B at 19:20: at 19:10 the crawl is between the two.
    const r = at('2026-12-26T19:10:00.000Z');
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('clock');
  });

  it('is the last stop, marked after, once the final departure has passed', () => {
    const r = at('2026-12-26T23:00:00.000Z');
    expect(r.stop?.id).toBe('C');
    expect(r.source).toBe('after');
    expect(r.nextStop).toBeNull();
    expect(r.departAt).toBeNull();
  });

  it('honours a correction newer than the arrival the clock would pick', () => {
    const r = currentStop(stops, legs, new Date('2026-12-26T18:30:00.000Z'), {
      startAt, override: { stopId: 'B', at: '2026-12-26T18:25:00.000Z' }
    });
    expect(r.stop?.id).toBe('B');
    expect(r.source).toBe('override');
    expect(r.nextStop?.id).toBe('C');
  });

  it('ignores a correction older than that arrival, so it cannot drag the crawl backwards', () => {
    // The clock says C (arrived 21:20); a correction made at 19:30 is stale and must not win.
    const r = currentStop(stops, legs, new Date('2026-12-26T22:00:00.000Z'), {
      startAt, override: { stopId: 'A', at: '2026-12-26T19:30:00.000Z' }
    });
    expect(r.stop?.id).toBe('C');
    // C is the last stop and has no onward leg, so the crawl counts as finished there.
    expect(r.source).toBe('after');
  });

  it('ignores a correction naming a stop that is not on the itinerary', () => {
    const r = currentStop(stops, legs, new Date('2026-12-26T18:30:00.000Z'), {
      startAt, override: { stopId: 'ZZZ', at: '2026-12-26T18:29:00.000Z' }
    });
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('clock');
  });

  it('returns nothing for an empty itinerary', () => {
    const r = currentStop([], [], new Date('2026-12-26T18:30:00.000Z'), { startAt });
    expect(r.stop).toBeNull();
    expect(r.source).toBe('before');
  });

  it('counts down to the train from an earlier stop at the same station', () => {
    // Two bars at La Grange: only the last one has a train leg, per the M1 layover model.
    const twoAtStation = [stop('A', 'AURORA', 1), stop('B1', 'LAGRANGE', 2), stop('B2', 'LAGRANGE', 3)];
    const walkLeg = { ...leg('B1', 'B2', '2026-12-26T20:00:00.000Z', '2026-12-26T20:05:00.000Z'), kind: 'walk' } as Leg;
    const ls = [leg('A', 'B1', '2026-12-26T19:00:00.000Z', '2026-12-26T19:20:00.000Z'), walkLeg];
    const r = currentStop(twoAtStation, ls, new Date('2026-12-26T19:30:00.000Z'), { startAt });
    expect(r.stop?.id).toBe('B1');
    expect(r.departAt).toBe('2026-12-26T20:00:00.000Z');
  });

  it('looks past same-station venues for the station the train actually goes to', () => {
    // At B1 the literal next stop is B2, another bar at La Grange. Asking for trains from LAGRANGE
    // to LAGRANGE returns nothing, so the board would claim there is no train at all.
    const sameStation = [stop('A', 'AURORA', 1), stop('B1', 'LAGRANGE', 2), stop('B2', 'LAGRANGE', 3), stop('C', 'CUS', 4)];
    const ls = [
      leg('A', 'B1', '2026-12-26T19:00:00.000Z', '2026-12-26T19:20:00.000Z'),
      { ...leg('B1', 'B2', '2026-12-26T20:00:00.000Z', '2026-12-26T20:05:00.000Z'), kind: 'walk' } as Leg,
      leg('B2', 'C', '2026-12-26T21:00:00.000Z', '2026-12-26T21:20:00.000Z')
    ];
    const r = currentStop(sameStation, ls, new Date('2026-12-26T19:30:00.000Z'), { startAt });
    expect(r.stop?.id).toBe('B1');
    expect(r.nextStop?.id).toBe('B2');
    expect(r.onwardStop?.id).toBe('C');
    expect(r.onwardStop?.station_id).toBe('CUS');
  });

  it('has no onward stop when every remaining venue shares this station', () => {
    const sameStation = [stop('B1', 'LAGRANGE', 1), stop('B2', 'LAGRANGE', 2)];
    const ls = [{ ...leg('B1', 'B2', '2026-12-26T20:00:00.000Z', '2026-12-26T20:05:00.000Z'), kind: 'walk' } as Leg];
    const r = currentStop(sameStation, ls, new Date('2026-12-26T19:30:00.000Z'), { startAt });
    expect(r.onwardStop).toBeNull();
  });

  it('onward is simply the next stop when the stations already differ', () => {
    expect(at('2026-12-26T18:30:00.000Z').onwardStop?.id).toBe('B');
  });
});
