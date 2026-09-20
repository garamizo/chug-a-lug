import { describe, expect, it } from 'vitest';
import { kindFromGoogleType, photoBytes, placeDetails, searchText } from '../../src/lib/server/places/google';

function capture(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return body instanceof Uint8Array ? new Response(body as BodyInit, { status }) : new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('kindFromGoogleType', () => {
  it('maps primary types', () => {
    expect(kindFromGoogleType('bar')).toBe('bar');
    expect(kindFromGoogleType('wine_bar')).toBe('bar');
    expect(kindFromGoogleType('mexican_restaurant')).toBe('restaurant');
    expect(kindFromGoogleType('cafe')).toBe('restaurant');
    expect(kindFromGoogleType('bowling_alley')).toBe('other');
    expect(kindFromGoogleType(undefined)).toBe('other');
  });
});

describe('searchText', () => {
  it('sends the key, field mask and location bias, and maps results', async () => {
    const { calls, fetchImpl } = capture({ places: [{ id: 'abc', displayName: { text: 'Tap House' }, formattedAddress: '1 Main St, Elmhurst, IL', location: { latitude: 41.9, longitude: -87.94 }, primaryType: 'bar' }] });
    const venues = await searchText({ key: 'K', fetchImpl }, 'tap house', { lat: 41.9, lon: -87.94, radiusM: 1500 });
    expect(venues).toEqual([{ source: 'google', id: 'abc', name: 'Tap House', kind: 'bar', lat: 41.9, lon: -87.94, address: '1 Main St, Elmhurst, IL' }]);
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('x-goog-api-key')).toBe('K');
    expect(headers.get('x-goog-fieldmask')).toContain('places.id');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ textQuery: 'tap house', locationBias: { circle: { center: { latitude: 41.9, longitude: -87.94 }, radius: 1500 } } });
  });
});

describe('placeDetails', () => {
  it('maps the details response', async () => {
    const { calls, fetchImpl } = capture({
      id: 'abc', displayName: { text: 'Tap House' }, formattedAddress: '1 Main St', location: { latitude: 1, longitude: 2 },
      regularOpeningHours: { weekdayDescriptions: ['Monday: Closed', 'Saturday: 11:00 AM – 2:00 AM'] }, rating: 4.4,
      nationalPhoneNumber: '(630) 555-0100', websiteUri: 'https://tap.example', googleMapsUri: 'https://maps.google.com/?cid=1',
      photos: [{ name: 'places/abc/photos/p1', authorAttributions: [{ displayName: 'Ann' }] }, { name: 'places/abc/photos/p2', authorAttributions: [] }]
    });
    const meta = await placeDetails({ key: 'K', fetchImpl }, 'abc');
    expect(calls[0].url).toBe('https://places.googleapis.com/v1/places/abc');
    expect(meta).toMatchObject({ id: 'abc', name: 'Tap House', address: '1 Main St', lat: 1, lon: 2, rating: 4.4, phone: '(630) 555-0100', website: 'https://tap.example', mapsUrl: 'https://maps.google.com/?cid=1' });
    expect(meta.hours).toEqual(['Monday: Closed', 'Saturday: 11:00 AM – 2:00 AM']);
    expect(meta.photos).toEqual([{ name: 'places/abc/photos/p1', attribution: 'Ann' }, { name: 'places/abc/photos/p2', attribution: '' }]);
  });
  it('throws with the status on failure', async () => {
    const { fetchImpl } = capture({ error: { message: 'nope' } }, 403);
    await expect(placeDetails({ key: 'K', fetchImpl }, 'abc')).rejects.toThrow('Google 403');
  });
});

describe('photoBytes', () => {
  it('requests the media endpoint with maxWidthPx and returns bytes', async () => {
    const { calls, fetchImpl } = capture(new Uint8Array([1, 2, 3]));
    const bytes = await photoBytes({ key: 'K', fetchImpl }, 'places/abc/photos/p1');
    expect(calls[0].url).toBe('https://places.googleapis.com/v1/places/abc/photos/p1/media?maxWidthPx=800');
    // The key belongs in the header only: a query-string copy would leak into logs and redirects.
    expect(new Headers(calls[0].init.headers).get('x-goog-api-key')).toBe('K');
    expect([...bytes]).toEqual([1, 2, 3]);
  });
});
