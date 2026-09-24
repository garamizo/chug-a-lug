import { describe, expect, it } from 'vitest';
import { hoursFor, safeWebsite, stationUrl, telHref, walkUrl } from '../../src/lib/live/venue';

describe('venue helpers', () => {
  const week = { source: 'google' as const, weekday: ['Monday: 11 AM – 2 AM', 'Saturday: 11 AM – 3 AM', 'Sunday: Closed'] };
  it('picks the event weekday’s hours and keeps the rest for the disclosure', () => {
    expect(hoursFor(week, 'Saturday')).toEqual({ line: 'Saturday: 11 AM – 3 AM', rest: ['Monday: 11 AM – 2 AM', 'Sunday: Closed'] });
    expect(hoursFor({ source: 'osm', raw: 'Mo-Su 11:00-02:00' }, 'Saturday')).toEqual({ line: 'Mo-Su 11:00-02:00', rest: [] });
    expect(hoursFor(null, 'Saturday')).toEqual({ line: null, rest: [] });
  });
  it('builds walking directions, preferring the Google place', () => {
    expect(walkUrl({ name: 'Tap', lat: 41.8, lon: -87.9, place_id: '' })).toBe('https://www.google.com/maps/dir/?api=1&destination=41.8%2C-87.9&travelmode=walking');
    expect(walkUrl({ name: 'Tap & Co', lat: 1, lon: 2, place_id: 'ChIJ' })).toContain('destination=Tap+%26+Co&travelmode=walking&destination_place_id=ChIJ');
  });
  it('walks back to a Metra station by name', () => {
    expect(stationUrl('La Grange Road')).toBe('https://www.google.com/maps/dir/?api=1&destination=La+Grange+Road+Metra+Station&travelmode=walking');
  });
  it('only links real phone numbers and web addresses', () => {
    expect(telHref('(708) 555-0101')).toBe('tel:7085550101');
    expect(telHref('')).toBe('');
    expect(safeWebsite('javascript:alert(1)')).toBe('');
    expect(safeWebsite('https://tap.example')).toBe('https://tap.example');
  });
});
