/** When the crawl finishes: the last stop's leave time that is known. */
export function finishAt(leaveTimes: (Date | null)[]): Date | null {
  for (let i = leaveTimes.length - 1; i >= 0; i--) if (leaveTimes[i]) return leaveTimes[i];
  return null;
}
