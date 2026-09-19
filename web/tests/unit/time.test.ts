import { describe, expect, it } from 'vitest';
import { localToUtc, minutesOfDay, parseHm, fmtHm, fmtTime, fmtDate } from '../../src/lib/time';

describe('time', () => {
  it('converts Chicago local minutes to UTC across DST', () => {
    expect(localToUtc('2026-12-26', 660).toISOString()).toBe('2026-12-26T17:00:00.000Z');
    expect(localToUtc('2026-07-04', 660).toISOString()).toBe('2026-07-04T16:00:00.000Z');
    expect(localToUtc('2026-12-26', 1510).toISOString()).toBe('2026-12-27T07:10:00.000Z');
  });
  it('inverts back to minutes past the service-day midnight', () => {
    expect(minutesOfDay('2026-12-26', '2026-12-27T07:10:00.000Z')).toBe(1510);
    expect(minutesOfDay('2026-12-26', localToUtc('2026-12-26', 660))).toBe(660);
  });
  it('parses and formats', () => {
    expect(parseHm('11:05')).toBe(665);
    expect(fmtHm(665)).toBe('11:05');
    expect(fmtHm(1510)).toBe('01:10');
    expect(fmtTime('2026-12-26T17:00:00.000Z')).toBe('11:00 AM');
    expect(fmtTime('2026-12-27T07:10:00.000Z')).toBe('1:10 AM');
    expect(fmtDate('2026-12-26')).toBe('Sat, Dec 26');
  });
});
