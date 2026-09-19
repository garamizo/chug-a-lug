import { describe, expect, it } from 'vitest';
import { localToUtc, minutesOfDay, parseHm, fmtHm, fmtTime, fmtDate } from '../../src/lib/time';

describe('time', () => {
  it('converts Chicago local minutes to UTC across DST', () => {
    expect(localToUtc('2026-12-26', 660).toISOString()).toBe('2026-12-26T17:00:00.000Z');
    expect(localToUtc('2026-07-04', 660).toISOString()).toBe('2026-07-04T16:00:00.000Z');
    expect(localToUtc('2026-12-26', 1510).toISOString()).toBe('2026-12-27T07:10:00.000Z');
  });
  it('resolves a spring-forward gap forward, staying monotonic', () => {
    // 2026-03-08: Chicago clocks jump from 2:00 AM CST straight to 3:00 AM CDT; 2:00-2:59 AM
    // local never happened.
    const before = localToUtc('2026-03-08', 119).getTime(); // 1:59 AM CST, exists
    expect(new Date(before).toISOString()).toBe('2026-03-08T07:59:00.000Z');
    const gap120 = localToUtc('2026-03-08', 120).getTime(); // 2:00 AM, does not exist
    const gap121 = localToUtc('2026-03-08', 121).getTime(); // 2:01 AM, does not exist
    const after = localToUtc('2026-03-08', 180); // 3:00 AM CDT, exists
    expect(after.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(gap120).toBeGreaterThanOrEqual(before);
    expect(gap120).toBeLessThanOrEqual(after.getTime());
    expect(gap121).toBeGreaterThanOrEqual(gap120);
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
