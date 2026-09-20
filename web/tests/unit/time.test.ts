import { describe, expect, it } from 'vitest';
import { localToUtc, minutesOfDay, parseHm, fmtHm, fmtTime, fmtDate, fmtDateTime, todayInTz } from '../../src/lib/time';

describe('time', () => {
  it('converts Chicago local minutes to UTC across DST', () => {
    expect(localToUtc('2026-12-26', 660).toISOString()).toBe('2026-12-26T17:00:00.000Z');
    expect(localToUtc('2026-07-04', 660).toISOString()).toBe('2026-07-04T16:00:00.000Z');
    expect(localToUtc('2026-12-26', 1510).toISOString()).toBe('2026-12-27T07:10:00.000Z');
  });
  it('clamps a spring-forward gap to the transition instant, staying monotonic', () => {
    // 2026-03-08: Chicago clocks jump from 2:00 AM CST straight to 3:00 AM CDT; 2:00-2:59 AM
    // local never happened, so every minute in the gap clamps to the transition instant, the
    // same instant as the first valid post-gap minute (3:00 AM CDT = 08:00Z).
    expect(localToUtc('2026-03-08', 119).toISOString()).toBe('2026-03-08T07:59:00.000Z');
    expect(localToUtc('2026-03-08', 120).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(localToUtc('2026-03-08', 150).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(localToUtc('2026-03-08', 179).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(localToUtc('2026-03-08', 180).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(localToUtc('2026-03-08', 181).toISOString()).toBe('2026-03-08T08:01:00.000Z');
  });
  it('stays non-decreasing across full days spanning both DST transitions', () => {
    for (const date of ['2026-03-08', '2026-11-01']) {
      let prev = -Infinity;
      for (let m = 0; m <= 1560; m++) {
        const t = localToUtc(date, m).getTime();
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
  });
  it('resolves fall-back to the first occurrence of the repeated hour', () => {
    // 2026-11-01: Chicago clocks fall back from 2:00 AM CDT to 1:00 AM CST; 1:00-1:59 AM local
    // happens twice, and localToUtc always picks the first (CDT) occurrence.
    expect(localToUtc('2026-11-01', 60).toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(localToUtc('2026-11-01', 120).toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(localToUtc('2026-11-01', 1500).toISOString()).toBe('2026-11-02T07:00:00.000Z');
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
  it('formats a local date and time together, past midnight UTC', () => {
    // 2026-09-20T00:15Z is still 2026-09-19 evening in Chicago (UTC-5 in September); fmtDateTime
    // must use the Chicago calendar date, not the UTC one.
    expect(fmtDateTime('2026-09-20T00:15:00.000Z')).toBe('Sat, Sep 19, 7:15 PM');
  });
});

describe('todayInTz', () => {
  it("gives the Chicago date, not the runner's", () => {
    // 05:30 UTC on the 27th is still the 26th in Chicago.
    expect(todayInTz(new Date('2026-12-27T05:30:00Z'))).toBe('2026-12-26');
  });
  it('rolls over at Chicago midnight', () => {
    expect(todayInTz(new Date('2026-12-27T06:30:00Z'))).toBe('2026-12-27');
  });
});
