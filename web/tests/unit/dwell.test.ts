import { describe, expect, it } from 'vitest';
import { dwellOptions, GENERIC_DWELL } from '../../src/lib/dwell';
import { fmtDur } from '../../src/lib/time';

const arrive = new Date('2026-12-26T17:00:00.000Z'); // 11:00 AM Chicago
const trip = (hm: string) => ({ schedDepart: `2026-12-26T${hm}:00.000Z` });

describe('fmtDur', () => {
  it('prints minutes, whole hours, and hours with minutes', () => {
    expect(fmtDur(0)).toBe('0 min');
    expect(fmtDur(45)).toBe('45 min');
    expect(fmtDur(60)).toBe('1 h');
    expect(fmtDur(173)).toBe('2 h 53 min');
  });
});

describe('dwellOptions', () => {
  it('turns each train into the layover that catches it, minus the walk to the station', () => {
    // Trains at 12:55 PM and 1:55 PM Chicago; a 2-minute walk.
    const out = dwellOptions(arrive, 2, [trip('18:55'), trip('19:55')], 60);
    expect(out.map((o) => o.value)).toEqual([60, 113, 173]);
    expect(out[0]).toMatchObject({ value: 60, current: true });
    expect(out[1].depart?.toISOString()).toBe('2026-12-26T18:55:00.000Z');
  });
  it('does not repeat the current layover when a train already matches it, and never goes negative', () => {
    const out = dwellOptions(arrive, 10, [trip('17:05'), trip('18:55')], 105);
    expect(out.map((o) => o.value)).toEqual([0, 105]);
    expect(out.filter((o) => o.current)).toHaveLength(1);
  });
  it('falls back to half-hour steps when there are no trains to pick from', () => {
    const out = dwellOptions(arrive, 2, [], 60);
    expect(out.map((o) => o.value)).toEqual(GENERIC_DWELL);
    expect(dwellOptions(arrive, 2, [], 75).map((o) => o.value)).toEqual([0, 30, 60, 75, 90, 120, 150, 180, 240]);
    expect(dwellOptions(null, 2, [], 75).map((o) => o.value)).toContain(75);
  });
});
