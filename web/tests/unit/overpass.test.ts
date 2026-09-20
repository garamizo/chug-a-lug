import { describe, expect, it } from 'vitest';
import { fetchNearby, overpassQuery, parseOverpass } from '../../src/lib/server/places/overpass';

const origin = { lat: 41.8811111, lon: -88.1988889 };
const sample = {
  elements: [
    { type: 'node', id: 1, lat: 41.8837, lon: -88.1990, tags: { amenity: 'restaurant', name: 'Far Diner', cuisine: 'mexican', opening_hours: 'Tu-Su 09:00-20:00', phone: '+1 630 473 0378', 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'West Chicago' } },
    { type: 'way', id: 2, center: { lat: 41.8815, lon: -88.1985 }, tags: { amenity: 'pub', name: 'Near Pub', website: 'https://nearpub.example' } },
    { type: 'node', id: 3, lat: 41.882, lon: -88.198, tags: { amenity: 'bar' } },
    { type: 'node', id: 4, lat: 41.8812, lon: -88.1992, tags: { craft: 'brewery', name: 'Hop House' } },
    { type: 'node', id: 5, lat: 41.8813, lon: -88.1993, tags: { amenity: 'cafe', name: 'Bean' } }
  ]
};

describe('parseOverpass', () => {
  it('maps nodes and ways to venues sorted by distance, dropping unnamed ones', () => {
    const venues = parseOverpass(sample, origin);
    expect(venues.map((v) => v.name)).toEqual(['Hop House', 'Bean', 'Near Pub', 'Far Diner']);
    expect(venues[0]).toMatchObject({ source: 'osm', id: 'node/4', kind: 'bar' });
    expect(venues[1].kind).toBe('restaurant');
    expect(venues[2]).toMatchObject({ id: 'way/2', kind: 'bar', lat: 41.8815, website: 'https://nearpub.example' });
    expect(venues[3]).toMatchObject({ kind: 'restaurant', address: '12 Main St, West Chicago', phone: '+1 630 473 0378', hours: { source: 'osm', raw: 'Tu-Su 09:00-20:00' } });
    expect(venues[3].distanceM).toBeGreaterThan(250);
  });
});

describe('overpassQuery', () => {
  it('asks for bars, restaurants and breweries around a point', () => {
    const q = overpassQuery(41.5, -88.25, 800);
    expect(q).toContain('around:800,41.5,-88.25');
    expect(q).toContain('amenity');
    expect(q).toContain('brewery');
    expect(q).toContain('out center tags');
  });
});

describe('fetchNearby', () => {
  it('POSTs the query with a User-Agent and parses the result', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify(sample)); }) as unknown as typeof fetch;
    const venues = await fetchNearby({ url: 'http://overpass.test/api', fetchImpl }, origin.lat, origin.lon);
    expect(venues).toHaveLength(4);
    expect(seen!.url).toBe('http://overpass.test/api');
    expect(seen!.init.method).toBe('POST');
    expect(new Headers(seen!.init.headers).get('user-agent')).toContain('chugalug');
    expect(String(seen!.init.body)).toMatch(/^data=/);
  });
  it('throws on a non-OK status', async () => {
    const fetchImpl = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
    await expect(fetchNearby({ url: 'http://x', fetchImpl }, 0, 0)).rejects.toThrow('Overpass 429');
  });
});
