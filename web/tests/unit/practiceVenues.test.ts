import { describe, expect, it } from 'vitest';
import { PLAN, nextFreeSaturday, pickBar, pickDeepDish, pickLunch } from '../../scripts/practice-venues.mjs';

const station = { id: 'LISLE', lat: 41.7955, lon: -88.0751 };
const place = (id: string, over: object = {}) => ({ id, displayName: { text: id }, location: { latitude: 41.7956, longitude: -88.0752 },
  primaryType: 'bar', types: ['bar'], businessStatus: 'OPERATIONAL', rating: 4.5, userRatingCount: 300, ...over });

describe('practice route plan', () => {
  it('goes out to LaGrange and back, lunch out, deep-dish dinner back, bars at other stations', () => {
    expect(PLAN.map((p) => `${p.direction}:${p.station}:${p.role}`)).toEqual([
      'out:AURORA:bar', 'out:NAPERVILLE:bar', 'out:LISLE:lunch', 'out:MAINST-DG:bar', 'out:LAGRANGE:bar',
      'in:HINSDALE:bar', 'in:WESTMONT:bar', 'in:NAPERVILLE:dinner', 'in:ROUTE59:bar'
    ]);
    expect(PLAN.map((p) => p.dwell)).toEqual([30, 30, 60, 30, 30, 30, 30, 75, 30]);
  });
  it('picks the nearest operational bar with enough ratings, never twice', () => {
    const used = new Set(['taken']);
    const far = place('far', { location: { latitude: 41.80, longitude: -88.08 } });
    expect(pickBar([place('taken'), place('few', { userRatingCount: 5 }), place('closed', { businessStatus: 'CLOSED_PERMANENTLY' }), far], station, used)?.id).toBe('far');
  });
  it('picks a well-rated restaurant open at noon for lunch', () => {
    const open = { periods: [{ open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 22, minute: 0 } }] };
    const late = { periods: [{ open: { day: 6, hour: 16, minute: 0 }, close: { day: 6, hour: 23, minute: 0 } }] };
    const r = (id: string, rating: number, hours: object) => place(id, { primaryType: 'mexican_restaurant', types: ['restaurant'], rating, userRatingCount: 400, regularOpeningHours: hours });
    expect(pickLunch([r('dinner-only', 4.9, late), r('lunch', 4.4, open), r('small', 4.8, { periods: open.periods })].map((p, i) => i === 2 ? { ...p, userRatingCount: 50 } : p), station, new Set())?.id).toBe('lunch');
  });
  it('picks a deep-dish house at the dinner station, not merely the best-rated place nearby', () => {
    const dd = (id: string, name: string, over: object = {}) => place(id, { displayName: { text: name }, primaryType: 'pizza_restaurant', ...over });
    const got = pickDeepDish([
      dd('antonino', "Antonino's Ristorante", { rating: 4.9, primaryType: 'italian_restaurant' }),  // not deep dish
      dd('gio', "Giordano's", { rating: 4.4, userRatingCount: 1748 }),
      dd('lou', "Lou Malnati's Pizzeria", { rating: 4.5, userRatingCount: 5063 }),
      dd('far', "Gino's East", { rating: 4.8, location: { latitude: 41.83, longitude: -88.07 } })   // ~3.9 km away
    ], station, new Set());
    expect(got?.id).toBe('lou');
  });
  it('finds no deep dish rather than settling for another restaurant', () => {
    expect(pickDeepDish([place('x', { displayName: { text: 'Some Grill' }, primaryType: 'restaurant', rating: 4.9 })], station, new Set())).toBeNull();
  });
  it('dates the route on the next Saturday that no locked route uses', () => {
    expect(nextFreeSaturday('2026-09-24', [])).toBe('2026-09-26');
    expect(nextFreeSaturday('2026-09-26', [])).toBe('2026-10-03');   // "next", never today
    expect(nextFreeSaturday('2026-09-24', ['2026-09-26'])).toBe('2026-10-03');
  });
});
