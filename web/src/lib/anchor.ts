// When the Conductor's newest check-in steers the day. Shared by the planner (`activeAnchor`) and
// the live board (`LiveDay.effectiveAnchor`) so the two never disagree about which check-in counts.
import { todayInTz } from '$lib/time';

/**
 * True only on the event day, for a check-in made on the event date. Every Route save writes a
 * check-in, off-day ones included, so the newest check-in can be days old on the event morning.
 */
export function anchorOnEventDay(
  eventDate: string,
  anchor: { stopId: string; at: string } | null,
  now: Date
): boolean {
  return !!anchor && eventDate === todayInTz(now) && todayInTz(new Date(anchor.at)) === eventDate;
}
