import { describe, expect, it } from 'vitest';
import { BUFFER_MIN, WARNING_MIN, boardState, boardingJourney, pickTrip, plannedTrain, rideHome } from '../../src/lib/live/board';
import type { Current } from '../../src/lib/live/current';
import type { Leg, NextTrip, Stop } from '../../src/lib/types';

const trip = (tripId: string, depart: string): NextTrip => ({
  tripId, routeId: 'BNSF', headsign: 'Chicago', schedDepart: depart, schedArrive: depart,
  liveDepart: depart, liveArrive: depart, delayMin: 0, status: 'live'
});

const state = (nowIso: string, departIso = '2026-12-26T20:31:00.000Z', walkMin = 5) =>
  boardState({ departAt: new Date(departIso), walkMin, now: new Date(nowIso) });

describe('boardState', () => {
  it('subtracts the walk and the buffer to get the leave time', () => {
    const r = state('2026-12-26T19:00:00.000Z');
    // 20:31 minus 5 min walk minus 3 min buffer.
    expect(r.leaveAt.toISOString()).toBe('2026-12-26T20:23:00.000Z');
    expect(r.departsInMin).toBe(83);
    expect(r.state).toBe('normal');
  });

  it('is normal just outside the warning window', () => {
    // leaveAt 20:23; 10 min before is 20:13.
    expect(state('2026-12-26T20:12:00.000Z').state).toBe('normal');
  });

  it('warns from the threshold inwards', () => {
    expect(state('2026-12-26T20:13:00.000Z').state).toBe('warning');
    expect(state('2026-12-26T20:22:00.000Z').state).toBe('warning');
  });

  it('says leave now at the leave time and after it', () => {
    expect(state('2026-12-26T20:23:00.000Z').state).toBe('leave_now');
    expect(state('2026-12-26T20:30:00.000Z').state).toBe('leave_now');
  });

  it('reports the train missed once it has departed', () => {
    expect(state('2026-12-26T20:32:00.000Z').state).toBe('missed');
  });

  it('uses the documented constants', () => {
    expect(BUFFER_MIN).toBe(3);
    expect(WARNING_MIN).toBe(10);
  });

  it('clamps a zero walk without going negative on the countdown', () => {
    const r = state('2026-12-26T20:31:00.000Z', '2026-12-26T20:31:00.000Z', 0);
    expect(r.state).toBe('leave_now');
    expect(r.departsInMin).toBeLessThanOrEqual(0);
  });
});

describe('pickTrip', () => {
  it('picks the first trip that has not departed', () => {
    const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
    expect(pickTrip(trips, new Date('2026-12-26T20:30:00.000Z'))?.tripId).toBe('T2');
  });

  it('keeps the current trip while it is still catchable', () => {
    const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
    expect(pickTrip(trips, new Date('2026-12-26T19:00:00.000Z'))?.tripId).toBe('T1');
  });

  it('falls back to the scheduled time when there is no live one', () => {
    const t = { ...trip('T1', '2026-12-26T20:00:00.000Z'), liveDepart: null };
    expect(pickTrip([t], new Date('2026-12-26T19:00:00.000Z'))?.tripId).toBe('T1');
  });

  it('returns null when every trip has gone', () => {
    expect(pickTrip([trip('T1', '2026-12-26T20:00:00.000Z')], new Date('2026-12-26T21:00:00.000Z'))).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickTrip([], new Date())).toBeNull();
  });
});

describe('pickTrip with a planned train', () => {
  const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
  it('counts down to the planned train, not an earlier one', () => {
    expect(pickTrip(trips, new Date('2026-12-26T19:00:00.000Z'), 'T2')?.tripId).toBe('T2');
  });
  it('falls back to the next train once the planned one has gone', () => {
    const later = [...trips, trip('T3', '2026-12-26T22:00:00.000Z')];
    expect(pickTrip(later, new Date('2026-12-26T21:30:00.000Z'), 'T2')?.tripId).toBe('T3');
  });
  it('falls back to the next train when the planned one is not in the list', () => {
    expect(pickTrip(trips, new Date('2026-12-26T19:00:00.000Z'), 'T9')?.tripId).toBe('T1');
  });
});

describe('plannedTrain', () => {
  const stop = (id: string, order: number, station_id: string) => ({ id, order, station_id }) as Stop;
  const seg = (tripId: string, from: string, dep: string) =>
    ({ kind: 'train' as const, tripId, routeId: 'BNSF', headsign: 'Chicago', from, to: 'CUS', dep, arr: dep });
  const leg = (from_stop: string, segments: Leg['segments']) => ({ from_stop, segments }) as Leg;
  const stops = [stop('a', 0, 'LAGRANGE'), stop('b', 1, 'LAGRANGE'), stop('c', 2, 'CUS')];

  it('is the first train the plan takes from the given station', () => {
    const legs = [
      leg('b', [seg('BN4', 'LAGRANGE', '2026-12-26T18:30:00.000Z')]),
      leg('a', [{ kind: 'walk', minutes: 3, from: 'LAGRANGE', to: 'LAGRANGE' }])
    ];
    expect(plannedTrain(stops, legs, 'LAGRANGE')).toEqual({ tripId: 'BN4', dep: '2026-12-26T18:30:00.000Z' });
  });

  it('is null when no planned train leaves that station', () => {
    expect(plannedTrain(stops, [leg('a', [])], 'LAGRANGE')).toBeNull();
  });

  it('prefers the opening leg, which sorts before every stop', () => {
    const legs = [
      leg('a', [seg('BN4', 'LAGRANGE', '2026-12-26T20:30:00.000Z')]),
      leg('', [seg('BN2', 'LAGRANGE', '2026-12-26T18:30:00.000Z')])
    ];
    expect(plannedTrain(stops, legs, 'LAGRANGE')).toEqual({ tripId: 'BN2', dep: '2026-12-26T18:30:00.000Z' });
  });
});

describe('boardingJourney', () => {
  const stop = (id: string, order: number, station_id: string, station_name: string) => ({ id, order, station_id, station_name, walk_min: 5 }) as Stop;
  const seg = { kind: 'train' as const, tripId: 'BN2', routeId: 'BNSF', headsign: 'Chicago', from: 'AURORA', to: 'NAPERVILLE', dep: '2026-12-26T17:12:00.000Z', arr: '2026-12-26T17:31:00.000Z' };
  const opening = { from_stop: '', to_stop: 'a', kind: 'train', segments: [seg] } as unknown as Leg;
  const stops = [stop('a', 1, 'NAPERVILLE', 'Naperville')];
  const it1 = { start_station: 'AURORA', start_station_name: 'Aurora' };
  const before = { stop: stops[0], nextStop: null, onwardStop: null, departAt: null, source: 'before' } as Current;

  it('is the ride from the start station to stop 1 before the crawl, even with one stop', () => {
    expect(boardingJourney(it1, stops, [opening], before)).toEqual({
      from: 'AURORA', fromName: 'Aurora', to: 'NAPERVILLE', toName: 'Naperville', walkMin: 0,
      planned: { tripId: 'BN2', dep: '2026-12-26T17:12:00.000Z' }
    });
  });
  it('is null once the crawl has started', () => {
    expect(boardingJourney(it1, stops, [opening], { ...before, source: 'clock' })).toBeNull();
  });
  it('is null with no start station, or when stop 1 is at it, or with no train', () => {
    expect(boardingJourney({ start_station: '', start_station_name: '' }, stops, [opening], before)).toBeNull();
    expect(boardingJourney({ start_station: 'NAPERVILLE', start_station_name: 'Naperville' }, stops, [opening], before)).toBeNull();
    expect(boardingJourney(it1, stops, [{ ...opening, kind: 'impossible', segments: [] } as Leg], before)).toBeNull();
  });
});

describe('rideHome', () => {
  const stop = (id: string, order: number, station_id: string, dwell_min = 30) => ({ id, order, station_id, station_name: station_id, dwell_min, walk_min: 5 }) as Stop;
  const stops = [stop('a', 1, 'NAPERVILLE'), stop('b', 2, 'LAGRANGE')];
  const itin = { start_station: 'AURORA', start_station_name: 'Aurora' };
  const seg = { kind: 'train' as const, tripId: 'BN9', routeId: 'BNSF', headsign: 'Aurora', from: 'LAGRANGE', to: 'AURORA', dep: '2026-12-26T23:00:00.000Z', arr: '2026-12-26T23:40:00.000Z' };
  const closing = (extra: Partial<Leg> = {}) => ({ from_stop: 'b', to_stop: '', kind: 'train', ready_at: '2026-12-26T22:30:00.000Z',
    depart_at: seg.dep, arrive_at: seg.arr, segments: [seg], ...extra }) as unknown as Leg;
  const here = (over: Partial<Current> = {}) => ({ stop: stops[1], nextStop: null, onwardStop: null, departAt: seg.dep, source: 'clock', ...over }) as Current;
  const at = (iso: string) => new Date(iso);

  it('is null before the crawl and at a non-last stop', () => {
    expect(rideHome(itin, stops, [closing()], here({ source: 'before' }), at('2026-12-26T22:00:00Z'), null)).toBeNull();
    expect(rideHome(itin, stops, [closing()], here({ stop: stops[0] }), at('2026-12-26T22:00:00Z'), null)).toBeNull();
    expect(rideHome(itin, stops, [closing()], here({ source: 'after' }), at('2026-12-26T23:50:00Z'), null)).toBeNull();
  });
  it('is null with no Board at station', () => {
    expect(rideHome({ start_station: '', start_station_name: '' }, stops, [closing()], here(), at('2026-12-26T22:00:00Z'), null)).toBeNull();
  });
  it('no rideHome for a walk', () => {
    const walk = closing({ kind: 'walk', segments: [{ kind: 'walk', minutes: 5, from: 'LAGRANGE', to: 'AURORA' }] } as Partial<Leg>);
    expect(rideHome(itin, stops, [walk], here(), at('2026-12-26T22:00:00Z'), null)).toBeNull();
  });
  it('no rideHome when the run home is impossible, even though it still carries times', () => {
    const impossible = closing({ kind: 'impossible', reason: 'after_midnight' } as Partial<Leg>);
    expect(rideHome(itin, stops, [impossible], here(), at('2026-12-26T22:00:00Z'), null)).toBeNull();
  });
  it('is waiting before the home train leaves and riding from its departure minute', () => {
    const waiting = rideHome(itin, stops, [closing()], here(), at('2026-12-26T22:59:00Z'), null);
    expect(waiting).toEqual({ from: 'LAGRANGE', fromName: 'LAGRANGE', to: 'AURORA', toName: 'Aurora',
      planned: { tripId: 'BN9', dep: seg.dep }, arriveAt: seg.arr, riding: false });
    expect(rideHome(itin, stops, [closing()], here(), at('2026-12-26T23:00:00Z'), null)?.riding).toBe(true);
    expect(rideHome(itin, stops, [closing()], here({ source: 'override' }), at('2026-12-26T23:20:00Z'), null)?.riding).toBe(true);
  });
  it('stale legs after a terminal correction are not riding', () => {
    // Checked in at 22:40: the closing leg should be ready at 23:10, but it still says 22:30.
    const anchor = { stopId: 'b', at: '2026-12-26T22:40:00.000Z' };
    expect(rideHome(itin, stops, [closing()], here({ source: 'override' }), at('2026-12-26T23:05:00Z'), anchor)).toBeNull();
    const fresh = closing({ ready_at: '2026-12-26T23:10:00.000Z' } as Partial<Leg>);
    expect(rideHome(itin, stops, [fresh], here({ source: 'override' }), at('2026-12-26T23:05:00Z'), anchor)).not.toBeNull();
  });
});
