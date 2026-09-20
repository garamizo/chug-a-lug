import { describe, expect, it } from 'vitest';
import { insertionIndex, placeStops, plannerStations } from '../../src/lib/lineMap';
import type { Line, Station } from '../../src/lib/types';

const st = (id: string): Station => ({ id, name: id, lat: 0, lon: 0 });
// Top to bottom on the map: the outer terminal first, downtown last.
const stations = [st('AURORA'), st('NAPERVILLE'), st('LAGRANGE'), st('CUS')];
const stops = (...ids: string[]) => ids.map((station_id) => ({ station_id }));
// "NAP+" is a going stop, "NAP-" a return stop.
const dir = (...ids: string[]) => ids.map((s) => ({ station_id: s.slice(0, -1), direction: (s.endsWith('-') ? 'back' : 'out') as 'out' | 'back' }));

describe('plannerStations', () => {
  it('takes the BNSF line and flips it so Aurora is on top and Union Station at the bottom', () => {
    const lines: Line[] = [
      { routeId: 'UP-W', name: 'UP-W', color: '#f00', stations: [st('OTC'), st('ELMHURST')] },
      { routeId: 'BNSF', name: 'BNSF', color: '#0f0', stations: [st('CUS'), st('LAGRANGE'), st('AURORA')] }
    ];
    expect(plannerStations(lines).map((s) => s.id)).toEqual(['AURORA', 'LAGRANGE', 'CUS']);
    expect(plannerStations([lines[0]])).toEqual([]);
  });
});

describe('placeStops', () => {
  it('puts a stop on the side of the direction it was reached in: toward Chicago left, back out right', () => {
    const p = placeStops(stations, stops('NAPERVILLE', 'LAGRANGE', 'CUS', 'LAGRANGE'));
    expect(p.side).toEqual(['left', 'left', 'left', 'right']);
    expect(p.rows.map((r) => [r.station.id, r.left, r.right])).toEqual([
      ['AURORA', [], []], ['NAPERVILLE', [0], []], ['LAGRANGE', [1], [3]], ['CUS', [2], []]
    ]);
    expect(p.offLine).toEqual([]);
  });

  it('never moves an existing stop when a later one is added', () => {
    const before = placeStops(stations, stops('NAPERVILLE', 'LAGRANGE', 'CUS', 'LAGRANGE')).side;
    const after = placeStops(stations, stops('NAPERVILLE', 'LAGRANGE', 'CUS', 'LAGRANGE', 'CUS')).side;
    expect(after.slice(0, 4)).toEqual(before);
    expect(after[4]).toBe('left');
  });

  it('keeps stops at the same station together and gives the first stop its leaving direction', () => {
    expect(placeStops(stations, stops('NAPERVILLE', 'NAPERVILLE', 'CUS')).side).toEqual(['left', 'left', 'left']);
    expect(placeStops(stations, stops('CUS', 'CUS', 'NAPERVILLE')).side).toEqual(['right', 'right', 'right']);
    expect(placeStops(stations, stops('LAGRANGE', 'NAPERVILLE', 'NAPERVILLE')).side).toEqual(['right', 'right', 'right']);
  });

  it('defaults a single stop, or one station only, to the left', () => {
    expect(placeStops(stations, stops('LAGRANGE')).side).toEqual(['left']);
    expect(placeStops(stations, stops('LAGRANGE', 'LAGRANGE')).side).toEqual(['left', 'left']);
    expect(placeStops(stations, []).rows.every((r) => !r.left.length && !r.right.length)).toBe(true);
  });

  it('shares Union Station’s row with Ogilvie and lists other lines’ stations under the map', () => {
    const p = placeStops(stations, stops('NAPERVILLE', 'OTC', 'ELMHURST', 'LAGRANGE'));
    expect(p.side).toEqual(['left', 'left', 'left', 'right']);
    expect(p.rows.find((r) => r.station.id === 'CUS')!.left).toEqual([1]);
    expect(p.offLine).toEqual([2]);
  });

  it('with no stations known, every stop goes under the map', () => {
    const p = placeStops([], stops('NAPERVILLE', 'CUS'));
    expect(p.rows).toEqual([]);
    expect(p.offLine).toEqual([0, 1]);
  });
});

describe('placeStops with an explicit direction', () => {
  it('uses the stop’s own direction instead of guessing from its neighbours', () => {
    const p = placeStops(stations, dir('NAPERVILLE+', 'LAGRANGE+', 'LAGRANGE-', 'NAPERVILLE-'));
    expect(p.side).toEqual(['left', 'left', 'right', 'right']);
    expect(p.rows.map((r) => [r.station.id, r.left, r.right])).toEqual([
      ['AURORA', [], []], ['NAPERVILLE', [0], [3]], ['LAGRANGE', [1], [2]], ['CUS', [], []]
    ]);
  });
  it('still guesses for stops saved before directions existed', () => {
    const mixed = [{ station_id: 'NAPERVILLE', direction: 'out' as const }, { station_id: 'CUS' }, { station_id: 'LAGRANGE', direction: 'back' as const }];
    expect(placeStops(stations, mixed).side).toEqual(['left', 'left', 'right']);
  });
});

describe('insertionIndex', () => {
  const crawl = dir('NAPERVILLE+', 'CUS+', 'LAGRANGE-');
  it('slots a going stop among the going stops, top to bottom', () => {
    expect(insertionIndex(stations, crawl, 'AURORA', 'out')).toBe(0);
    expect(insertionIndex(stations, crawl, 'LAGRANGE', 'out')).toBe(1);
    expect(insertionIndex(stations, crawl, 'CUS', 'out')).toBe(2);
    expect(insertionIndex(stations, crawl, 'NAPERVILLE', 'out')).toBe(1); // after the existing Naperville stop
  });
  it('slots a return stop after every going stop, bottom to top', () => {
    expect(insertionIndex(stations, crawl, 'CUS', 'back')).toBe(2);
    expect(insertionIndex(stations, crawl, 'LAGRANGE', 'back')).toBe(3);
    expect(insertionIndex(stations, crawl, 'NAPERVILLE', 'back')).toBe(3);
    expect(insertionIndex(stations, dir('NAPERVILLE+', 'CUS+'), 'LAGRANGE', 'back')).toBe(2);
  });
  it('appends when the crawl is empty or the station is off the line', () => {
    expect(insertionIndex(stations, [], 'LAGRANGE', 'back')).toBe(0);
    expect(insertionIndex(stations, crawl, 'ELMHURST', 'out')).toBe(2);
    expect(insertionIndex(stations, crawl, 'ELMHURST', 'back')).toBe(3);
  });
});
