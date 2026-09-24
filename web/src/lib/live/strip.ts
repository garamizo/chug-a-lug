// The route strip: which stops are behind the crew, where it is now, and what is still ahead.
import type { Current } from './current';
import type { Leg, Stop } from '$lib/types';

export type StripState = 'done' | 'current' | 'next';
export type LinkKind = 'train' | 'walk';
export type StripStop = { stop: Stop; state: StripState; arriveAt: string | null; arriveBy: LinkKind | null; leaveBy: LinkKind | null };

export function stripStops(stops: Stop[], legs: Leg[], here: Current | null, startAt: Date): StripStop[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const arrive = new Map(legs.map((l) => [l.to_stop, l.arrive_at]));
  // Only a train leg is drawn as track; a walk, or a leg the planner could not make, is a plain line.
  const by = new Map(legs.map((l) => [l.to_stop, l.kind === 'train' ? 'train' as const : 'walk' as const]));
  const link = (i: number): LinkKind | null => i <= 0 || i >= ordered.length ? null : by.get(ordered[i].id) ?? 'walk';
  const underway = here?.source === 'clock' || here?.source === 'override';
  const at = underway ? ordered.findIndex((s) => s.id === here!.stop?.id) : -1;
  return ordered.map((stop, i) => ({
    stop,
    state: here?.source === 'after' || i < at ? 'done' : i === at ? 'current' : 'next',
    arriveAt: i === 0 ? startAt.toISOString() : arrive.get(stop.id) ?? null,
    arriveBy: link(i),
    leaveBy: link(i + 1)
  }));
}
