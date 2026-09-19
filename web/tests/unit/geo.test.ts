import { describe, expect, it } from 'vitest';
import { haversineM, walkMinutes } from '../../src/lib/geo';

describe('geo', () => {
  it('measures OTC to Union Station at about 400 m', () => {
    const m = haversineM(41.8822222, -87.6405556, 41.8788889, -87.6388889);
    expect(m).toBeGreaterThan(380);
    expect(m).toBeLessThan(410);
  });
  it('walks at 80 m per minute, rounded up, at least one minute', () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(395)).toBe(5);
    expect(walkMinutes(800)).toBe(10);
    expect(walkMinutes(801)).toBe(11);
  });
});
