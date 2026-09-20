// Presentation mapping for the board, kept out of the component so it can be unit-tested.
import { labels, copy } from '$lib/labels';
import type { BoardState } from './board';

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
