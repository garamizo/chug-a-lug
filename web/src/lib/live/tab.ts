// The Tab: what the crew has had at the stop they are in. The day's totals are the Hall of Fame's
// job, so nothing here looks past the current stop.
import type { DrinkEntry, DrinkKind } from '$lib/types';

export const DRINK_KINDS: DrinkKind[] = ['beer', 'wine', 'cocktail', 'shot', 'water', 'food'];

export type Tally = {
  crew: Record<DrinkKind, number>;
  mine: Record<DrinkKind, number>;
  /** The caller's newest entry at this stop: what Undo removes. */
  lastMine: DrinkEntry | null;
};

const zeroes = (): Record<DrinkKind, number> =>
  Object.fromEntries(DRINK_KINDS.map((k) => [k, 0])) as Record<DrinkKind, number>;

export function tally(entries: DrinkEntry[], stopId: string, userId: string): Tally {
  const crew = zeroes(), mine = zeroes();
  let lastMine: DrinkEntry | null = null;
  for (const e of entries) {
    if (e.stop !== stopId || !DRINK_KINDS.includes(e.kind)) continue;
    crew[e.kind] += 1;
    if (e.user === userId) {
      mine[e.kind] += 1;
      if (!lastMine || e.at > lastMine.at) lastMine = e;
    }
  }
  return { crew, mine, lastMine };
}
