// The route strip: which stops are behind the crew, where it is now, and what is still ahead.
import type { Current } from './current';
import type { Leg, Stop } from '$lib/types';

export type StripState = 'done' | 'current' | 'next';
export type StripStop = { stop: Stop; state: StripState; arriveAt: string | null };

export function stripStops(stops: Stop[], legs: Leg[], here: Current | null, startAt: Date): StripStop[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const arrive = new Map(legs.map((l) => [l.to_stop, l.arrive_at]));
  const underway = here?.source === 'clock' || here?.source === 'override';
  const at = underway ? ordered.findIndex((s) => s.id === here!.stop?.id) : -1;
  return ordered.map((stop, i) => ({
    stop,
    state: here?.source === 'after' || i < at ? 'done' : i === at ? 'current' : 'next',
    arriveAt: i === 0 ? startAt.toISOString() : arrive.get(stop.id) ?? null
  }));
}
