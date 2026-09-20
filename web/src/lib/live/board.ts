// The Departure Board's state machine. Pure, with `now` injected, so M4's sim clock drives it
// without changing a line here.
import type { NextTrip } from '$lib/types';

/** Minutes of slack between arriving on the platform and the train leaving. */
export const BUFFER_MIN = 3;
/** How far out the first warning (Last Call) appears. */
export const WARNING_MIN = 10;

export type BoardState = 'normal' | 'warning' | 'leave_now' | 'missed';
export type Board = { state: BoardState; leaveAt: Date; departsInMin: number };

export function boardState(opts: { departAt: Date; walkMin: number; now: Date }): Board {
  const leaveAt = new Date(opts.departAt.getTime() - (opts.walkMin + BUFFER_MIN) * 60_000);
  const departsInMin = Math.round((leaveAt.getTime() - opts.now.getTime()) / 60_000);
  const state: BoardState =
    opts.now.getTime() > opts.departAt.getTime() ? 'missed'
    : departsInMin > WARNING_MIN ? 'normal'
    : departsInMin > 0 ? 'warning'
    : 'leave_now';
  return { state, leaveAt, departsInMin };
}

/** The first trip that has not left yet: the one the board counts down to. */
export function pickTrip(trips: NextTrip[], now: Date): NextTrip | null {
  return trips.find((t) => new Date(t.liveDepart ?? t.schedDepart).getTime() > now.getTime()) ?? null;
}
