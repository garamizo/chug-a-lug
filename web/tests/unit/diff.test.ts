import { describe, expect, it } from 'vitest';
import { bulletinKind, bulletinText, planDiff } from '../../src/lib/live/diff';

const stop = (id: string, order: number, name: string, dwell = 60, station = 'La Grange Road') =>
  ({ id, order, name, dwell_min: dwell, station_name: station });

const before = {
  anchorStopId: 'a',
  stops: [stop('a', 1, 'The Hop Haus'), stop('b', 2, 'The Second Round'), stop('c', 3, 'Berwyn Beer Hall', 60, 'Union Station')]
};

describe('planDiff', () => {
  it('sees nothing in an unchanged plan', () => {
    expect(planDiff(before, before)).toEqual([]);
  });

  it('reports the crew moving', () => {
    expect(planDiff(before, { ...before, anchorStopId: 'b' }))
      .toEqual([{ kind: 'position', stopName: 'The Second Round' }]);
  });

  it('reports a longer layover, with the train it is waiting for', () => {
    const after = { ...before, stops: [stop('a', 1, 'The Hop Haus', 120), before.stops[1], before.stops[2]] };
    expect(planDiff(before, after, () => '2026-12-26T20:44:00.000Z'))
      .toEqual([{ kind: 'hold', stopName: 'The Hop Haus', departAt: '2026-12-26T20:44:00.000Z' }]);
  });

  it('reports an annulled stop', () => {
    const after = { ...before, stops: [before.stops[0], stop('c', 2, 'Berwyn Beer Hall', 60, 'Union Station')] };
    expect(planDiff(before, after)).toEqual([{ kind: 'annul', stopName: 'The Second Round' }]);
  });

  it('reports an extra stop with its station', () => {
    const after = { ...before, stops: [...before.stops, stop('tmp_1', 4, 'Prairie Path Tap', 60, 'Wheaton')] };
    expect(planDiff(before, after)).toEqual([{ kind: 'extra', stopName: 'Prairie Path Tap', stationName: 'Wheaton' }]);
  });

  it('reports a reorder as a reroute naming what now comes after', () => {
    const after = { ...before, stops: [stop('b', 1, 'The Second Round'), stop('a', 2, 'The Hop Haus'), before.stops[2]] };
    expect(planDiff(before, after)).toEqual([{ kind: 'reroute', stopName: 'The Second Round', beforeName: 'The Hop Haus' }]);
  });
});

describe('bulletinKind', () => {
  it('picks the most significant change', () => {
    expect(bulletinKind([{ kind: 'hold', stopName: 'x', departAt: null }, { kind: 'annul', stopName: 'y' }])).toBe('annul');
    expect(bulletinKind([{ kind: 'annul', stopName: 'y' }, { kind: 'reroute', stopName: 'z', beforeName: 'w' }])).toBe('reroute');
    expect(bulletinKind([{ kind: 'position', stopName: 'x' }])).toBe('message');
    expect(bulletinKind([])).toBe('message');
  });
});

describe('bulletinText', () => {
  it('writes one sentence per change, in the crew’s vocabulary', () => {
    const text = bulletinText([
      { kind: 'position', stopName: 'The Hop Haus' },
      { kind: 'hold', stopName: 'The Hop Haus', departAt: '2026-12-26T20:44:00.000Z' },
      { kind: 'annul', stopName: 'Berwyn Beer Hall' },
      { kind: 'extra', stopName: 'Prairie Path Tap', stationName: 'Wheaton' },
      { kind: 'reroute', stopName: 'The Second Round', beforeName: 'The Hop Haus' }
    ]);
    expect(text).toBe(
      'We are still at The Hop Haus. Holding at The Hop Haus until the 2:44 PM. ' +
      'Berwyn Beer Hall is annulled. Extra stop: Prairie Path Tap, Wheaton. ' +
      'Rerouted: The Second Round before The Hop Haus.'
    );
  });

  it('holds without a train when no departure is known', () => {
    expect(bulletinText([{ kind: 'hold', stopName: 'The Hop Haus', departAt: null }]))
      .toBe('Staying longer at The Hop Haus.');
  });
});
