import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creditDate, watchCreditDate, type CreditStatus } from '../../src/lib/metraCredit';

const PUBLISHED = '11/14/26 02:20:03 AM America/Chicago';
const live = (staticPublishedAt: string, extra: Partial<CreditStatus> = {}): CreditStatus =>
  ({ source: 'live', staticSource: 'download', staticPublishedAt, ...extra });

describe('creditDate', () => {
  it('reads Metra’s published.txt as written', () => {
    expect(creditDate(live(PUBLISHED))).toBe('Nov 14, 2026');
    expect(creditDate(live('12/31/26 11:59:59 PM America/Chicago'))).toBe('Dec 31, 2026');
    expect(creditDate(live('01/02/27 12:00:00 PM America/Chicago', { staticSource: 'cache' }))).toBe('Jan 2, 2027');
  });
  it('shows no date unless it is Metra’s real publish date', () => {
    expect(creditDate(live('2026-10-26T18:00:00.000Z', { staticSource: 'file' }))).toBe('');
    expect(creditDate(live(PUBLISHED, { staticSource: 'file' }))).toBe('');
    expect(creditDate(live(PUBLISHED, { source: 'timetable' }))).toBe('');
    expect(creditDate(live(PUBLISHED, { source: 'recording' }))).toBe('');
    expect(creditDate(live(''))).toBe('');
    expect(creditDate(live('garbage'))).toBe('');
    expect(creditDate(live('13/40/26 02:20:03 AM America/Chicago'))).toBe('');
    expect(creditDate(live('02/31/26 02:20:03 AM America/Chicago'))).toBe('');   // no Feb 31
    expect(creditDate(live('02/29/27 02:20:03 AM America/Chicago'))).toBe('');   // 2027 is not leap
    expect(creditDate(live('11/14/26 13:20:03 PM America/Chicago'))).toBe('');   // 12-hour clock
    expect(creditDate(live('11/14/26 02:61:03 AM America/Chicago'))).toBe('');
    expect(creditDate(live('11/14/26 02:20:03 AM'))).toBe('');                   // zone required
    expect(creditDate(live('11/14/26 02:20:03 AM America/Chicago junk'))).toBe('');
  });
  it('accepts Feb 29 in a leap year', () => {
    expect(creditDate(live('02/29/28 09:00:00 AM America/Chicago'))).toBe('Feb 29, 2028');
  });
});

describe('watchCreditDate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const deferred = () => {
    let resolve!: (s: CreditStatus) => void;
    const promise = new Promise<CreditStatus>((r) => { resolve = r; });
    return { promise, resolve };
  };

  it('fetches at once and every interval', async () => {
    const fetch = vi.fn(async () => live(PUBLISHED));
    const dates: string[] = [];
    const stop = watchCreditDate(fetch, (d) => dates.push(d), 600_000);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(dates).toEqual(['Nov 14, 2026']);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reports no date when the call fails', async () => {
    const dates: string[] = [];
    const stop = watchCreditDate(() => Promise.reject(new Error('HTTP 503')), (d) => dates.push(d));
    await flush();
    expect(dates).toEqual(['']);
    stop();
  });

  it('ignores an answer that lands after dispose, and clears on dispose', async () => {
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const dates: string[] = [];
    const stop = watchCreditDate(fetch, (d) => dates.push(d), 600_000);
    stop();
    expect(dates).toEqual(['']);
    pending.resolve(live(PUBLISHED));
    await flush();
    expect(dates).toEqual(['']);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never overlaps calls', async () => {
    const first = deferred();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(live(PUBLISHED));
    const dates: string[] = [];
    const stop = watchCreditDate(fetch, (d) => dates.push(d), 600_000);
    await vi.advanceTimersByTimeAsync(600_000);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    first.resolve(live(PUBLISHED));
    await flush();
    expect(dates).toEqual(['Nov 14, 2026']);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });
});
