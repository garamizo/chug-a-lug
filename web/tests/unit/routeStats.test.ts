import { describe, expect, it } from 'vitest';
import { finishAt } from '../../src/lib/routeStats';

describe('finishAt', () => {
  it('is the last known leave time', () => {
    const a = new Date('2026-12-26T18:00:00Z'), b = new Date('2026-12-26T22:40:00Z');
    expect(finishAt([a, b])).toEqual(b);
    expect(finishAt([a, null])).toEqual(a);
    expect(finishAt([])).toBeNull();
  });
});
