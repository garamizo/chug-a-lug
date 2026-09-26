// What the home screen says: the countdown on the ticket and the status chips on the board.
import { copy } from './labels';

/** Whole days between two YYYY-MM-DD dates (both already Chicago dates). */
export function daysUntil(eventDate: string, today: string): number {
  const utc = (d: string) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
  return Math.round((utc(eventDate) - utc(today)) / 86_400_000);
}

export function countdownText(eventDate: string, today: string): string | null {
  const n = daysUntil(eventDate, today);
  if (n < 0) return null;
  if (n === 0) return copy.countdownToday;
  if (n === 1) return copy.countdownTomorrow;
  return `${n} ${copy.countdownDays}`;
}

export type Chip = { text: string; tone: 'go' | 'gold' | 'muted' | 'red' };

export const plannerChip = (): Chip => ({ text: copy.chipBoarding, tone: 'go' });

export function liveChip(s: { hasRoute: boolean; isEventDay: boolean }): Chip {
  if (!s.hasRoute) return { text: copy.chipSoon, tone: 'muted' };
  if (s.isEventDay) return { text: copy.chipToday, tone: 'red' };
  // Same word as the Live practice banner (copy.practiceBadge) — one key for one piece of text.
  return { text: copy.practiceBadge, tone: 'gold' };
}

export const wrapUpChip: Chip = { text: copy.chipSoon, tone: 'muted' };
