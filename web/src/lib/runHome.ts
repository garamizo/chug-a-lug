import { copy } from './labels';

/** Why an impossible run home is impossible. Too late is its own answer; otherwise a station with no
 *  trains that day (the last stop's, or Board at's) is named; otherwise the generic no-train text. */
export function runHomeReason(reason: string | undefined, noServiceMessage: string | undefined, homeName: string): string {
  if (reason === 'after_midnight') return copy.runHomeMidnight;
  return noServiceMessage ?? `${copy.runHome} ${homeName}: ${copy.noTrain}`;
}
