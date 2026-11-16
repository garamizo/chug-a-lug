import { describe, expect, it } from 'vitest';
import { finishAt, routeFinish } from '../../src/lib/routeStats';

describe('finishAt', () => {
  it('is the last known leave time', () => {
    const a = new Date('2026-12-26T18:00:00Z'), b = new Date('2026-12-26T22:40:00Z');
    expect(finishAt([a, b])).toEqual(b);
    expect(finishAt([a, null])).toEqual(a);
    expect(finishAt([])).toBeNull();
  });
});

describe('routeFinish', () => {
  const a = new Date('2026-12-26T18:00:00Z'), b = new Date('2026-12-26T22:40:00Z');
  it('is the arrival home when the run home can be ridden', () => {
    expect(routeFinish({ kind: 'train', arrive_at: '2026-12-27T00:10:00Z' }, [a, b])).toEqual(new Date('2026-12-27T00:10:00Z'));
  });
  it('is unknown when the run home cannot be ridden, not the last venue\'s leave time', () => {
    expect(routeFinish({ kind: 'impossible', arrive_at: '2026-12-26T22:44:00Z' }, [a, b])).toBeNull();
  });
  it('falls back to the last leave time on a route without a run home', () => {
    expect(routeFinish(undefined, [a, b])).toEqual(b);
  });
});
