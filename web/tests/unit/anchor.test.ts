import { describe, expect, it } from 'vitest';
import { anchorOnEventDay } from '$lib/anchor';

describe('anchorOnEventDay', () => {
  const anchor = { stopId: 'a', at: '2026-12-26T17:25:00.000Z' };
  it('counts a check-in made on the event date, read on the event date', () => {
    expect(anchorOnEventDay('2026-12-26', anchor, new Date('2026-12-26T18:00:00.000Z'))).toBe(true);
  });
  it('ignores every check-in off the event day', () => {
    expect(anchorOnEventDay('2026-12-26', anchor, new Date('2026-12-27T18:00:00.000Z'))).toBe(false);
  });
  it('ignores a check-in left over from another day, even on the event day', () => {
    // 05:59Z on the 26th is still the 25th in Chicago.
    const stale = { stopId: 'a', at: '2026-12-26T05:59:00.000Z' };
    expect(anchorOnEventDay('2026-12-26', stale, new Date('2026-12-26T15:00:00.000Z'))).toBe(false);
  });
  it('has nothing to count without a check-in', () => {
    expect(anchorOnEventDay('2026-12-26', null, new Date('2026-12-26T15:00:00.000Z'))).toBe(false);
  });
});
