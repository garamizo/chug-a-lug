// Chicago local time helpers. The database stores UTC; GTFS and the planner think in minutes since
// the service day's midnight (which can exceed 1440 for trains after midnight).
export const TZ = 'America/Chicago';

function offsetMinutes(utcMs: number): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Minutes after local midnight of `date` (YYYY-MM-DD) as a UTC instant. */
export function localToUtc(date: string, minutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d) + minutes * 60_000;
  let result = guess - offsetMinutes(guess) * 60_000;
  const off2 = offsetMinutes(result);
  if (off2 !== offsetMinutes(guess)) result = guess - off2 * 60_000;
  return new Date(result);
}

/** Inverse of localToUtc for the given service date. */
export function minutesOfDay(date: string, iso: string | Date): number {
  const midnight = localToUtc(date, 0).getTime();
  return Math.round((new Date(iso).getTime() - midnight) / 60_000);
}

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function fmtHm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/ /g, ' ');
}

export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}
