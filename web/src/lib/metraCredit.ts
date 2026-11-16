// The Metra credit's date: Metra's own timetable publish date, or nothing. The license wants the
// credit with a last-updated date (README), and a wrong date is worse than none, so only the live
// stack's downloaded or cached `published.txt` counts: a `file:` timetable reports its mtime and a
// simulation its service date in the same field.
import type { MetraStatus } from '$lib/types';

export type CreditStatus = Pick<MetraStatus, 'source' | 'staticPublishedAt' | 'staticSource'>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// published.txt, e.g. `11/14/26 02:20:03 AM America/Chicago`: already Chicago time, so the date is
// read as written; going through Date or Intl could move it across midnight.
const PUBLISHED = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) (AM|PM) (\S+)$/;

function daysIn(month: number, year: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `Nov 14, 2026` when the status carries Metra's real publish date, else ''. */
export function creditDate(status: CreditStatus): string {
  if (status.source !== 'live' || (status.staticSource !== 'download' && status.staticSource !== 'cache')) return '';
  const m = PUBLISHED.exec(status.staticPublishedAt);
  if (!m) return '';
  const [month, day, yy, hour, minute, second] = m.slice(1, 7).map(Number);
  const year = 2000 + yy;
  if (month < 1 || month > 12 || day < 1 || day > daysIn(month, year)) return '';
  if (hour < 1 || hour > 12 || minute > 59 || second > 59) return '';
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * Reads the status at once and every `intervalMs`, one call at a time, and reports the credit date
 * ('' on failure). The returned dispose clears the date and drops any answer still in flight.
 */
export function watchCreditDate(fetchStatus: () => Promise<CreditStatus>, onDate: (date: string) => void,
  intervalMs = 600_000): () => void {
  let disposed = false;
  let inFlight = false;
  const tick = () => {
    if (disposed || inFlight) return;
    inFlight = true;
    fetchStatus()
      .then((s) => { if (!disposed) onDate(creditDate(s)); })
      .catch(() => { if (!disposed) onDate(''); })
      .finally(() => { inFlight = false; });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => { disposed = true; clearInterval(timer); onDate(''); };
}
