// The Tab: what the crew has had at the stop they are in. The day's totals are the Hall of Fame's
// job, so nothing here looks past the current stop.
import type { DrinkEntry, DrinkKind } from '$lib/types';

export const DRINK_KINDS: DrinkKind[] = ['shot', 'cocktail', 'beer', 'water', 'food'];

export type Tally = {
  crew: Record<DrinkKind, number>;
  mine: Record<DrinkKind, number>;
  /** The caller's newest entry at this stop: what Undo removes. */
  lastMine: DrinkEntry | null;
};

const zeroes = (): Record<DrinkKind, number> =>
  Object.fromEntries(DRINK_KINDS.map((k) => [k, 0])) as Record<DrinkKind, number>;

// Legacy mirrors lack the server sequence; created/id provides stable order, not recovered request order.
function newer(a: DrinkEntry, b: DrinkEntry): boolean {
  if (a.at !== b.at) return a.at > b.at;
  const aOrder = a.action_order ?? 0, bOrder = b.action_order ?? 0;
  if (aOrder !== bOrder) return aOrder > bOrder;
  if (a.created !== b.created) return (a.created ?? '') > (b.created ?? '');
  return a.id > b.id;
}

export function tally(entries: DrinkEntry[], stopId: string, userId: string): Tally {
  const crew = zeroes(), mine = zeroes();
  let lastMine: DrinkEntry | null = null;
  for (const e of entries) {
    if (e.stop !== stopId || !DRINK_KINDS.includes(e.kind)) continue;
    crew[e.kind] += 1;
    if (e.user === userId) {
      mine[e.kind] += 1;
      if (!lastMine || newer(e, lastMine)) lastMine = e;
    }
  }
  return { crew, mine, lastMine };
}
