import { describe, expect, it } from 'vitest';
import { isEventDay, planNow, projectToPlanDate } from '../../src/lib/live/planClock';

describe('plan clock', () => {
  it('is the event day only on the route date in Chicago', () => {
    expect(isEventDay('2026-12-26', new Date('2026-12-26T06:00:00Z'))).toBe(true);   // 00:00 CST
    expect(isEventDay('2026-12-26', new Date('2026-12-26T05:59:00Z'))).toBe(false);  // still the 25th
  });
  it('lays todays time of day onto the route date', () => {
    // Tuesday 14:05 CDT → the event day's 14:05 CST
    expect(projectToPlanDate(new Date('2026-09-22T19:05:00Z'), '2026-12-26').toISOString()).toBe('2026-12-26T20:05:00.000Z');
  });
  it('keeps real time on the event day and when there is no route', () => {
    const now = new Date('2026-12-26T18:00:00Z');
    expect(planNow('2026-12-26', now)).toBe(now);
    expect(planNow(null, now)).toBe(now);
  });
  it('projects across midnight without wrapping to the next day', () => {
    // 23:59 Chicago practice → 23:59 on the event date, never 00:00 of the day after
    const p = projectToPlanDate(new Date('2026-09-23T04:59:00Z'), '2026-12-26');
    expect(p.toISOString()).toBe('2026-12-27T05:59:00.000Z');
  });
  it('keeps seconds, so 23:59:30 stays on the event date', () => {
    const p = projectToPlanDate(new Date('2026-09-23T04:59:30.250Z'), '2026-12-26');
    expect(p.toISOString()).toBe('2026-12-27T05:59:30.250Z');
  });
  it('uses the wall-clock time on DST transition days, not minutes since midnight', () => {
    // 2026-03-08 spring forward: 14:00 CDT is 13 elapsed hours after midnight, but it is still 14:00
    expect(projectToPlanDate(new Date('2026-03-08T19:00:00Z'), '2026-12-26').toISOString()).toBe('2026-12-26T20:00:00.000Z');
    // 2026-11-01 fall back: 14:00 CST is 15 elapsed hours after midnight
    expect(projectToPlanDate(new Date('2026-11-01T20:00:00Z'), '2026-12-26').toISOString()).toBe('2026-12-26T20:00:00.000Z');
  });
  it('resolves a time the route date skips or repeats the way localToUtc does', () => {
    // Practising at 02:30 for a route on 2027-03-14 (02:00-03:00 does not exist): the transition instant
    expect(projectToPlanDate(new Date('2026-09-22T07:30:00Z'), '2027-03-14').toISOString()).toBe('2027-03-14T08:00:00.000Z');
    // Practising at 01:30 for a route on 2026-11-01 (01:00-02:00 happens twice): the first one, CDT
    expect(projectToPlanDate(new Date('2026-09-22T06:30:00Z'), '2026-11-01').toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });
});
