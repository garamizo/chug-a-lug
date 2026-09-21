// Presentation mapping for the board, kept out of the component so it can be unit-tested.
import { labels, copy } from '$lib/labels';
import { boardState, type BoardState } from './board';
import type { NextTrip } from '$lib/types';

export type Tone = 'calm' | 'last' | 'aboard';

export const boardTone = (state: BoardState): Tone =>
  state === 'warning' ? 'last' : state === 'leave_now' ? 'aboard' : 'calm';

/** The big line on the card. */
export function leadLine(state: BoardState, departsInMin: number): string {
  if (state === 'missed') return copy.missedTrain;
  if (state === 'warning') return labels.firstWarning;
  if (state === 'leave_now') return labels.leaveNow;
  return `${copy.leaveIn} ${Math.max(0, departsInMin)} ${copy.minutes}`;
}

/** The one-line banner: where we are and how long we have. */
export function compactLine(stopName: string, walkMin: number, trip: NextTrip | null, now: Date): string {
  if (!trip) return `${stopName} · ${copy.noTrainLeft}`;
  const departAt = new Date(trip.liveDepart ?? trip.schedDepart);
  const board = boardState({ departAt, walkMin, now });
  const tail = board.state === 'leave_now' ? labels.leaveNow
    : board.state === 'warning' ? labels.firstWarning
    : board.state === 'missed' ? copy.missedTrainShort
    : `${copy.leaveIn} ${Math.max(0, board.departsInMin)} ${copy.minutes}`;
  return `${stopName} · ${tail}`;
}
