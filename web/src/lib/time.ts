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

/**
 * Minutes after local midnight of `date` (YYYY-MM-DD) as a UTC instant.
 * Fall-back (a repeated local hour, e.g. the 1 AM hour on 2026-11-01) always resolves to the
 * first occurrence, matching how GTFS treats repeated local times. Spring-forward (a skipped
 * local hour, e.g. 2:00-2:59 AM on 2026-03-08) clamps to the transition instant — the first
 * valid instant after the gap — so minutes keep advancing monotonically.
 */
export function localToUtc(date: string, minutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d) + minutes * 60_000;
  // Offsets in force a day before and a day after cover any transition near this local time.
  const offsets = [...new Set([offsetMinutes(guess - 86_400_000), offsetMinutes(guess + 86_400_000)])];
  const valid = offsets.map((off) => guess - off * 60_000).filter((t, i) => offsetMinutes(t) === offsets[i]);
  if (valid.length) return new Date(Math.min(...valid)); // fall-back overlap: first occurrence
  // Skipped local time (spring forward): clamp to the transition instant by bisecting between the candidates.
  const candidates = offsets.map((off) => guess - off * 60_000);
  let lo = Math.min(...candidates), hi = Math.max(...candidates);
  const before = offsetMinutes(lo);
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (offsetMinutes(mid) === before) lo = mid; else hi = mid;
  }
  return new Date(hi);
}

/**
 * Inverse of localToUtc for the given service date. Fall-back's repeated hour is likewise
 * resolved to the first occurrence (see localToUtc).
 */
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

/** "2 h 53 min", "1 h", "45 min". */
export function fmtDur(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/ /g, ' ');
}

export function fmtDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(/ /g, ' ');
}

export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2026-12-26" -> "Saturday" (or "Sat"). */
export function fmtWeekday(date: string, style: 'long' | 'short' = 'long'): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: style }).format(new Date(Date.UTC(y, m - 1, d)));
}
