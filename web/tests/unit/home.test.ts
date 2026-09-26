import { describe, expect, it } from 'vitest';
import { countdownText, daysUntil, liveChip, plannerChip, wrapUpChip } from '../../src/lib/home';

describe('home', () => {
  it('counts whole Chicago days to the event', () => {
    expect(daysUntil('2026-12-26', '2026-09-25')).toBe(92);
    expect(daysUntil('2026-12-26', '2026-12-26')).toBe(0);
    expect(daysUntil('2026-12-26', '2026-12-27')).toBe(-1);
    // Across the March DST change the answer is still whole days.
    expect(daysUntil('2027-03-15', '2027-03-13')).toBe(2);
  });
  it('writes the countdown', () => {
    expect(countdownText('2026-12-26', '2026-09-25')).toBe('92 days');
    expect(countdownText('2026-12-26', '2026-12-25')).toBe('Tomorrow');
    expect(countdownText('2026-12-26', '2026-12-26')).toBe('Today');
    expect(countdownText('2026-12-26', '2026-12-27')).toBeNull();
  });
  it('chips', () => {
    expect(plannerChip()).toEqual({ text: 'Boarding', tone: 'go' });
    expect(liveChip({ hasRoute: false, isEventDay: false })).toEqual({ text: 'Soon', tone: 'muted' });
    expect(liveChip({ hasRoute: true, isEventDay: false })).toEqual({ text: 'Practice', tone: 'gold' });
    expect(liveChip({ hasRoute: true, isEventDay: true })).toEqual({ text: 'Today', tone: 'red' });
    expect(wrapUpChip).toEqual({ text: 'Soon', tone: 'muted' });
  });
});
