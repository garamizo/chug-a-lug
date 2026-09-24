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
  it('chooses the best-rated deep-dish place across outbound stations', () => {
    const got = pickDeepDish({ NAPERVILLE: [place('lou', { primaryType: 'pizza_restaurant', rating: 4.5 })], LISLE: [place('gio', { primaryType: 'pizza_restaurant', rating: 4.3 })] }, new Set());
    expect(got).toEqual({ station: 'NAPERVILLE', place: expect.objectContaining({ id: 'lou' }) });
  });
  it('dates the route on the next Saturday that no locked route uses', () => {
    expect(nextFreeSaturday('2026-09-24', [])).toBe('2026-09-26');
    expect(nextFreeSaturday('2026-09-26', [])).toBe('2026-10-03');   // "next", never today
    expect(nextFreeSaturday('2026-09-24', ['2026-09-26'])).toBe('2026-10-03');
  });
});
