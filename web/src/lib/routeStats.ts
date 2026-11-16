/** When the crawl finishes: the last stop's leave time that is known. */
export function finishAt(leaveTimes: (Date | null)[]): Date | null {
  for (let i = leaveTimes.length - 1; i >= 0; i--) if (leaveTimes[i]) return leaveTimes[i];
  return null;
}

/**
 * The Finish stat. With a run home it is the arrival at the Board at station, or unknown (null)
 * when no train home can be ridden: the last venue's leave time would claim a finish the crew
 * cannot reach. A route without a closing leg keeps the last known leave time.
 */
export function routeFinish(closing: { kind: string; arrive_at: string } | undefined, leaveTimes: (Date | null)[]): Date | null {
  if (!closing) return finishAt(leaveTimes);
  return closing.kind === 'impossible' ? null : new Date(closing.arrive_at);
}
