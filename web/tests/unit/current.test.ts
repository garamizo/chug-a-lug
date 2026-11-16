import { describe, expect, it } from 'vitest';
import { closingFresh, closingLeg, crawlEnd, currentStop, stopTimings } from '../../src/lib/live/current';
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

  it('arrives at stop 1 when the opening leg does, not at the start', () => {
    const opening = leg('', 'A', '2026-12-26T17:30:00.000Z', '2026-12-26T18:20:00.000Z');
    const r = currentStop(stops, [opening, ...legs], new Date('2026-12-26T18:10:00.000Z'), { startAt });
    expect(r.source).toBe('before');
    expect(currentStop(stops, [opening, ...legs], new Date('2026-12-26T18:25:00.000Z'), { startAt }).source).toBe('clock');
  });

  it('lets a check-in end the before state even ahead of the planned arrival', () => {
    const opening = leg('', 'A', '2026-12-26T17:30:00.000Z', '2026-12-26T18:20:00.000Z');
    const r = currentStop(stops, [opening, ...legs], new Date('2026-12-26T18:05:00.000Z'), {
      startAt, override: { stopId: 'A', at: '2026-12-26T18:00:00.000Z' }
    });
    expect(r.source).toBe('override');
    expect(r.stop?.id).toBe('A');
  });
  it('keeps an early check-in once the original arrival at stop 1 has passed', () => {
    // Opening leg planned into A at 17:00; the crew checked in at B at 16:20 instead.
    const opening = leg('', 'A', '2026-12-26T16:30:00.000Z', '2026-12-26T17:00:00.000Z');
    const ls = [opening, ...legs];
    const override = { stopId: 'B', at: '2026-12-26T16:20:00.000Z' };
    for (const now of ['2026-12-26T16:40:00.000Z', '2026-12-26T17:10:00.000Z']) {
      const r = currentStop(stops, ls, new Date(now), { startAt, override });
      expect(r.stop?.id).toBe('B');
      expect(r.source).toBe('override');
      expect(r.onwardStop?.id).toBe('C');
    }
  });

  it('advances past a check-in by the replanned legs, not the history before it', () => {
    // Checked in at B at 16:20; recompute replanned B -> C to arrive 16:50. A's history says 17:00.
    const ls = [
      leg('', 'A', '2026-12-26T16:30:00.000Z', '2026-12-26T17:00:00.000Z'),
      leg('A', 'B', '2026-12-26T19:00:00.000Z', '2026-12-26T19:20:00.000Z'),
      leg('B', 'C', '2026-12-26T16:30:00.000Z', '2026-12-26T16:50:00.000Z')
    ];
    const r = currentStop(stops, ls, new Date('2026-12-26T16:55:00.000Z'), {
      startAt, override: { stopId: 'B', at: '2026-12-26T16:20:00.000Z' }
    });
    expect(r.stop?.id).toBe('C');
    expect(r.source).toBe('after');
  });

  it('does not advance past a check-in on legs that predate it', () => {
    // Running late: still at A at 19:30 though B was due 19:20, before recompute has replanned A -> B.
    const r = currentStop(stops, legs, new Date('2026-12-26T19:35:00.000Z'), {
      startAt, override: { stopId: 'A', at: '2026-12-26T19:30:00.000Z' }
    });
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('override');
  });

  describe('the run home', () => {
    const closing = (ready: string, depart: string, arrive: string, extra: Partial<Leg> = {}): Leg =>
      ({ ...leg('C', '', depart, arrive), ready_at: ready, ...extra }) as Leg;
    // Last stop C arrives 21:20 (dwell 60), train home departs 22:20, arrives 23:00.
    const home = closing('2026-12-26T22:20:00.000Z', '2026-12-26T22:30:00.000Z', '2026-12-26T23:00:00.000Z');
    const withHome = [...legs, home];
    const run = (iso: string, override?: { stopId: string; at: string }, ls = withHome) =>
      currentStop(stops, ls, new Date(iso), { startAt, override });

    it('the last stop departs on the train home', () => {
      expect(run('2026-12-26T21:30:00.000Z').departAt).toBe(home.depart_at);
    });
    it('still at the last stop while riding home', () => {
      const r = run('2026-12-26T22:45:00.000Z');
      expect(r.source).toBe('clock');
      expect(r.stop?.id).toBe('C');
    });
    it('after only once home', () => {
      expect(run('2026-12-26T22:59:00.000Z').source).toBe('clock');
      expect(run('2026-12-26T23:00:00.000Z').source).toBe('after');
    });
    it('an impossible run home never ends the crawl', () => {
      const bad = closing('2026-12-26T22:20:00.000Z', '', '', { kind: 'impossible', reason: 'after_midnight' });
      const ls = [...legs, bad];
      expect(run('2026-12-27T09:00:00.000Z', undefined, ls).source).toBe('clock');
      expect(crawlEnd(stops, ls, startAt)).toEqual({ at: null, reason: 'no_run_home' });
      const o = { stopId: 'C', at: '2026-12-26T21:20:00.000Z' };
      expect(run('2026-12-27T09:00:00.000Z', o, ls).source).toBe('override');
    });
    it('early terminal check-in, legs replanned', () => {
      // Checked in at C at 21:00 (before the 21:20 arrival); replanned ready_at = 22:00.
      const ls = [...legs, closing('2026-12-26T22:00:00.000Z', '2026-12-26T22:10:00.000Z', '2026-12-26T22:40:00.000Z')];
      const o = { stopId: 'C', at: '2026-12-26T21:00:00.000Z' };
      expect(run('2026-12-26T22:39:00.000Z', o, ls).source).toBe('override');
      expect(run('2026-12-26T22:40:00.000Z', o, ls).source).toBe('after');
    });
    it('late terminal check-in, legs replanned from it', () => {
      const ls = [...legs, closing('2026-12-26T23:00:00.000Z', '2026-12-26T23:10:00.000Z', '2026-12-26T23:40:00.000Z')];
      const o = { stopId: 'C', at: '2026-12-26T22:00:00.000Z' };
      expect(run('2026-12-26T23:30:00.000Z', o, ls).source).toBe('override');
      expect(run('2026-12-26T23:40:00.000Z', o, ls).source).toBe('after');
    });
    it('late terminal check-in with stale legs stays override', () => {
      const o = { stopId: 'C', at: '2026-12-26T23:30:00.000Z' };
      expect(run('2026-12-27T00:30:00.000Z', o).source).toBe('override');
    });
    it('check-in between scheduled arrival and ready time with stale legs stays override', () => {
      const a = [stop('A', 'AURORA', 1), stop('C', 'CUS', 2)];
      const arr = '2026-12-26T20:00:00.000Z';
      const stale = [leg('A', 'C', '2026-12-26T19:40:00.000Z', arr),
        closing('2026-12-26T21:00:00.000Z', '2026-12-26T21:10:00.000Z', '2026-12-26T21:40:00.000Z')];
      const fresh = [stale[0], closing('2026-12-26T21:30:00.000Z', '2026-12-26T21:40:00.000Z', '2026-12-26T22:10:00.000Z')];
      const o = { stopId: 'C', at: '2026-12-26T20:30:00.000Z' };
      const go = (ls: Leg[], iso: string) => currentStop(a, ls, new Date(iso), { startAt, override: o }).source;
      expect(go(stale, '2026-12-26T21:50:00.000Z')).toBe('override');
      expect(go(fresh, '2026-12-26T22:09:00.000Z')).toBe('override');
      expect(go(fresh, '2026-12-26T22:10:00.000Z')).toBe('after');
    });
    it('closingFresh', () => {
      const o = (at: string, stopId = 'C') => ({ stopId, at });
      expect(closingFresh(stops, withHome, null)).toBe(true);
      expect(closingFresh(stops, withHome, o('2026-12-26T21:00:00.000Z', 'A'))).toBe(true);
      expect(closingFresh(stops, withHome, o('2026-12-26T21:20:30.000Z'))).toBe(true);
      expect(closingFresh(stops, withHome, o('2026-12-26T20:50:00.000Z'))).toBe(false);
    });
    it('crawlEnd falls back without a closing leg, and with no stops', () => {
      expect(closingLeg(stops, legs)).toBeNull();
      expect(crawlEnd(stops, legs, startAt)).toEqual({ at: new Date('2026-12-26T21:20:00.000Z') });
      expect(crawlEnd([], [], startAt)).toEqual({ at: startAt });
      expect(crawlEnd(stops, withHome, startAt)).toEqual({ at: new Date(home.arrive_at) });
    });
  });
});

describe('stopTimings', () => {
  it('stopTimings matches the old timings', () => {
    const t = stopTimings([stops[2], stops[0], stops[1]], legs, startAt);
    expect(t.map((x) => x.stop.id)).toEqual(['A', 'B', 'C']);
    expect(t.map((x) => x.arriveAt)).toEqual([
      startAt.getTime(), Date.parse('2026-12-26T19:20:00.000Z'), Date.parse('2026-12-26T21:20:00.000Z')
    ]);
    expect(t.map((x) => x.departIso)).toEqual(['2026-12-26T19:00:00.000Z', '2026-12-26T21:00:00.000Z', null]);
    expect(t[0].next?.id).toBe('B');
  });
});
