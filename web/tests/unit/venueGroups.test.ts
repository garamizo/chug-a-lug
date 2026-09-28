import { describe, expect, it } from 'vitest';
import { groupByKind } from '../../src/lib/venueGroups';
import type { Venue } from '../../src/lib/types';

const v = (id: string, kind: string): Venue => ({ source: 'google', id, name: id, kind, lat: 0, lon: 0 } as Venue);

describe('groupByKind', () => {
  it('orders bars, restaurants, places; keeps the ranking inside each; drops empty groups', () => {
    const groups = groupByKind([v('r1', 'restaurant'), v('b1', 'bar'), v('r2', 'restaurant'), v('b2', 'bar')]);
    expect(groups.map((g) => [g.kind, g.venues.map((x) => x.id)])).toEqual([['bar', ['b1', 'b2']], ['restaurant', ['r1', 'r2']]]);
  });
  it('puts anything that is not a bar or restaurant under places', () => {
    expect(groupByKind([v('o1', 'other'), v('x', 'museum')])).toEqual([{ kind: 'other', venues: [v('o1', 'other'), v('x', 'museum')] }]);
  });
  it('returns nothing for no venues', () => { expect(groupByKind([])).toEqual([]); });
});
