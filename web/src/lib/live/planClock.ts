// Practice days: any day that is not the route's date runs the route at today's time of day on its
// own date, so the board shows the trains the crew would catch then. Only the timetable follows
// plan time; everything people post stays on real time.
import { localToUtc, TZ, todayInTz } from '$lib/time';

const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function isEventDay(eventDate: string, realNow: Date): boolean {
  return todayInTz(realNow) === eventDate;
}

/** The Chicago wall-clock time of `realNow` on `eventDate`. Not `minutesOfDay`: that counts elapsed
 *  minutes, which is an hour off on DST transition days, and it rounds away the seconds. A time the
 *  event date skips or repeats resolves as `localToUtc` resolves it (transition instant, first occurrence). */
export function projectToPlanDate(realNow: Date, eventDate: string): Date {
  const part = (type: string) => Number(clock.formatToParts(realNow).find((p) => p.type === type)!.value);
  const base = localToUtc(eventDate, part('hour') * 60 + part('minute')).getTime();
  return new Date(base + part('second') * 1000 + realNow.getUTCMilliseconds());
}

export function planNow(eventDate: string | null, realNow: Date): Date {
  return !eventDate || isEventDay(eventDate, realNow) ? realNow : projectToPlanDate(realNow, eventDate);
}
