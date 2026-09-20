import { describe, expect, it } from 'vitest';
import { rankNearby } from '../../src/lib/server/places/rank';
import type { Venue } from '../../src/lib/types';

const v = (name: string, distanceM: number, rating?: number, ratingCount?: number): Venue =>
  ({ source: 'google', id: name, name, kind: 'bar', lat: 0, lon: 0, distanceM, rating, ratingCount });

describe('rankNearby', () => {
  it('drops venues beyond the radius and puts the highest rated first', () => {
    const out = rankNearby([v('far', 600, 4.9, 900), v('ok', 200, 4.2, 50), v('best', 240, 4.7, 300), v('edge', 250, 4.7, 10)], 250);
    expect(out.map((x) => x.name)).toEqual(['best', 'edge', 'ok']);
  });
  it('breaks a tie by review count, then distance, and puts unrated venues last by distance', () => {
    const out = rankNearby([v('unrated far', 240), v('unrated near', 30), v('b', 100, 4.0, 20), v('a', 200, 4.0, 20), v('c', 50, 4.0, 5)], 250);
    expect(out.map((x) => x.name)).toEqual(['b', 'a', 'c', 'unrated near', 'unrated far']);
  });
  it('keeps a venue with no distance (a manual or cached entry) inside the radius', () => {
    const out = rankNearby([{ ...v('nodist', 0, 3.5), distanceM: undefined }], 250);
    expect(out).toHaveLength(1);
  });
});
