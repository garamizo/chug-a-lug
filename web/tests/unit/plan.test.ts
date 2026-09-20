import { describe, expect, it } from 'vitest';
import { nextTrips, planLeg, recomputeLegs } from '../../src/lib/metra/plan';
import { fixtureSchedule } from '../fixtures/loadFixture';

const s = fixtureSchedule();
const D = '2026-12-26';

describe('nextTrips', () => {
  it('lists departures after a time, in order, with arrival at the destination', () => {
    const trips = nextTrips(s, 'ELMHURST', 'WHEATON', 660, D);
    expect(trips.map((t) => [t.tripId, t.dep, t.arr])).toEqual([['UW1', 670, 690], ['UW3', 790, 810], ['UW5', 905, 922]]);
    expect(trips[0]).toMatchObject({ routeId: 'UP-W', headsign: 'Geneva', from: 'ELMHURST', to: 'WHEATON' });
  });
  it('includes calendar_dates extras and trips past midnight', () => {
    expect(nextTrips(s, 'ELMHURST', 'WHEATON', 1000, D).map((t) => t.tripId)).toEqual(['UW13', 'UW7', 'UW9']);
    expect(nextTrips(s, 'OTC', 'GENEVA', 1440, D)[0]).toMatchObject({ tripId: 'UW9', dep: 1480, arr: 1550 });
  });
  it('is express-aware: a trip must stop at both stations', () => {
    expect(nextTrips(s, 'OAKPARK', 'GENEVA', 840, D)[0].tripId).toBe('UW13');
  });
  it('respects direction', () => {
    expect(nextTrips(s, 'WHEATON', 'ELMHURST', 600, D)[0]).toMatchObject({ tripId: 'UW2', dep: 645, arr: 665 });
  });
  it('excludes services not running that day', () => {
    expect(nextTrips(s, 'OTC', 'GENEVA', 500, D)[0].tripId).toBe('UW1');
    expect(nextTrips(s, 'OTC', 'GENEVA', 500, '2026-12-28')[0].tripId).toBe('UW11');
    expect(nextTrips(s, 'ELMHURST', 'WHEATON', 0, '2026-12-27')).toEqual([]);
  });
  it('returns nothing for the same station or a missing station', () => {
    expect(nextTrips(s, 'OTC', 'OTC', 0, D)).toEqual([]);
    expect(nextTrips(s, 'OTC', 'NOWHERE', 0, D)).toEqual([]);
  });
});

describe('planLeg', () => {
  it('same station is a zero-minute walk', () => {
    expect(planLeg(s, 'WHEATON', 'WHEATON', 900, D)).toEqual({ kind: 'walk', segments: [{ kind: 'walk', minutes: 0, from: 'WHEATON', to: 'WHEATON' }], departMin: 900, arriveMin: 900 });
  });
  it('downtown terminals are a six-minute walk', () => {
    expect(planLeg(s, 'OTC', 'CUS', 900, D)).toMatchObject({ kind: 'walk', departMin: 900, arriveMin: 906, segments: [{ kind: 'walk', minutes: 6 }] });
  });
  it('takes the first direct train', () => {
    const leg = planLeg(s, 'ELMHURST', 'WHEATON', 660, D);
    expect(leg.kind).toBe('train');
    expect(leg.segments).toHaveLength(1);
    expect(leg).toMatchObject({ departMin: 670, arriveMin: 690 });
  });
  it('transfers downtown between lines, walking between OTC and Union', () => {
    const leg = planLeg(s, 'ELMHURST', 'NAPERVILLE', 660, D);
    expect(leg.kind).toBe('train');
    expect(leg.segments.map((x) => (x.kind === 'train' ? x.tripId : `walk${x.minutes}`))).toEqual(['UW2', 'walk6', 'BN1']);
    expect(leg).toMatchObject({ departMin: 665, arriveMin: 800 });
    const back = planLeg(s, 'NAPERVILLE', 'ELMHURST', 600, D);
    expect(back.segments.map((x) => (x.kind === 'train' ? x.tripId : `walk${x.minutes}`))).toEqual(['BN2', 'walk6', 'UW5']);
    expect(back.arriveMin).toBe(905);
  });
  it('rides to the other downtown terminal and walks across when the destination is downtown', () => {
    const leg = planLeg(s, 'ELMHURST', 'CUS', 660, D);
    expect(leg.kind).toBe('train');
    expect(leg.segments.map((x) => (x.kind === 'train' ? x.tripId : `walk${x.minutes}`))).toEqual(['UW2', 'walk6']);
    expect(leg.segments[0]).toMatchObject({ kind: 'train', dep: 665, arr: 695, to: 'OTC' });
    expect(leg.segments[1]).toMatchObject({ kind: 'walk', from: 'OTC', to: 'CUS' });
    expect(leg).toMatchObject({ departMin: 665, arriveMin: 701 });
    const back = planLeg(s, 'NAPERVILLE', 'OTC', 600, D);
    expect(back.segments.map((x) => (x.kind === 'train' ? x.tripId : `walk${x.minutes}`))).toEqual(['BN2', 'walk6']);
    expect(back).toMatchObject({ kind: 'train', departMin: 725, arriveMin: 781 });
  });

  it('walks across downtown first to catch a train from the other terminal', () => {
    // departMin is the moment the walk starts, i.e. the at-station time passed in.
    const leg = planLeg(s, 'CUS', 'GENEVA', 600, D);
    expect(leg.kind).toBe('train');
    expect(leg.segments.map((x) => (x.kind === 'train' ? x.tripId : `walk${x.minutes}`))).toEqual(['walk6', 'UW1']);
    expect(leg.segments[0]).toMatchObject({ kind: 'walk', from: 'CUS', to: 'OTC' });
    expect(leg.segments[1]).toMatchObject({ kind: 'train', dep: 640, arr: 710 });
    expect(leg).toMatchObject({ departMin: 600, arriveMin: 710 });
    expect(planLeg(s, 'OTC', 'NAPERVILLE', 600, D)).toMatchObject({ kind: 'train', departMin: 600, arriveMin: 800 });
  });

  it('is impossible after the last train', () => {
    expect(planLeg(s, 'GENEVA', 'ELMHURST', 1400, D)).toEqual({ kind: 'impossible', segments: [], departMin: 1400, arriveMin: 1400 });
  });
});

describe('recomputeLegs', () => {
  it('chains stops with dwell and walk times', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660 }, [
      { id: 'c', order: 3, station_id: 'WHEATON', dwell_min: 30, walk_min: 3 },
      { id: 'a', order: 1, station_id: 'ELMHURST', dwell_min: 60, walk_min: 5 },
      { id: 'd', order: 4, station_id: 'GENEVA', dwell_min: 30, walk_min: 4 },
      { id: 'b', order: 2, station_id: 'WHEATON', dwell_min: 90, walk_min: 8 }
    ]);
    expect(legs.map((l) => [l.fromStopId, l.toStopId, l.kind, l.readyMin, l.departMin, l.arriveMin])).toEqual([
      ['a', 'b', 'train', 720, 790, 818],
      ['b', 'c', 'walk', 908, 916, 919],
      ['c', 'd', 'train', 949, 1050, 1074]
    ]);
    expect(legs[0].segments[0]).toMatchObject({ kind: 'train', tripId: 'UW3' });
    expect(legs[2].segments[0]).toMatchObject({ kind: 'train', tripId: 'UW13' });
  });
  it('marks impossible legs and keeps going', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 1380 }, [
      { id: 'a', order: 1, station_id: 'GENEVA', dwell_min: 60, walk_min: 2 },
      { id: 'b', order: 2, station_id: 'ELMHURST', dwell_min: 10, walk_min: 2 },
      { id: 'c', order: 3, station_id: 'ELMHURST', dwell_min: 10, walk_min: 1 }
    ]);
    expect(legs[0]).toMatchObject({ kind: 'impossible', readyMin: 1440, departMin: 1442, arriveMin: 1444, segments: [] });
    expect(legs[1]).toMatchObject({ kind: 'walk', readyMin: 1454, arriveMin: 1457 });
  });
  it('returns no legs for fewer than two stops', () => {
    expect(recomputeLegs(s, { date: D, startMin: 660 }, [{ id: 'a', order: 1, station_id: 'OTC', dwell_min: 60, walk_min: 1 }])).toEqual([]);
  });
});

describe('recomputeLegs with an anchor', () => {
  // NAPERVILLE -> LAGRANGE -> CUS, the crawl starting at 11:00.
  const stops = [
    { id: 's1', order: 1, station_id: 'NAPERVILLE', dwell_min: 30, walk_min: 5 },
    { id: 's2', order: 2, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
    { id: 's3', order: 3, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
  ];

  it('plans from the start time when there is no anchor', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660 }, stops);
    // leg 1 catches BN2 out of Naperville at 12:05, reaching La Grange at 12:30 plus a 5 min walk.
    expect(legs[0]).toMatchObject({ kind: 'train', readyMin: 690, departMin: 725, arriveMin: 755 });
    // leg 2 is then too late for BN2 at La Grange (12:30) and waits for BN4 at 14:30.
    expect(legs[1]).toMatchObject({ kind: 'train', readyMin: 815, departMin: 870, arriveMin: 899 });
  });

  it('starts the anchored stop from the anchor minute and leaves earlier legs alone', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, anchor: { stopId: 's2', atMin: 660 } }, stops);
    expect(legs[0]).toMatchObject({ departMin: 725, arriveMin: 755 });
    // Anchored at 11:00 the crawl is ready at 12:00, on the platform at 12:05, and catches BN2 at
    // 12:30 into Union Station at 12:55 plus the 4 min walk.
    expect(legs[1]).toMatchObject({ kind: 'train', readyMin: 720, departMin: 750, arriveMin: 779 });
  });

  it('marks the leg impossible when the anchor is too late for the last train', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, anchor: { stopId: 's2', atMin: 840 } }, stops);
    expect(legs[1]).toMatchObject({ kind: 'impossible', readyMin: 900 });
  });

  it('anchors the first stop too', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, anchor: { stopId: 's1', atMin: 600 } }, stops);
    expect(legs[0]).toMatchObject({ readyMin: 630, departMin: 725 });
  });

  it('ignores an anchor whose stop is not in the plan', () => {
    const plain = recomputeLegs(s, { date: D, startMin: 660 }, stops);
    const ghost = recomputeLegs(s, { date: D, startMin: 660, anchor: { stopId: 'gone', atMin: 900 } }, stops);
    expect(ghost).toEqual(plain);
  });
});
