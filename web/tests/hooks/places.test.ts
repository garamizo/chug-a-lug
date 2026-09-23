// The places store against a live PocketBase: the nearby lookup writes venues and a lookup marker,
// the second call reads the database, and attach puts details and photos on the shared record.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PB, loginToken, post } from './setup';

const envState = vi.hoisted(() => ({ dataDir: '', googleKey: 'K' }));
vi.mock('$lib/server/env', () => ({
  serverEnv: {
    get pbUrl() { return process.env.PB_URL ?? 'http://127.0.0.1:8090'; },
    get pbAdminEmail() { return process.env.PB_ADMIN_EMAIL ?? ''; },
    get pbAdminPassword() { return process.env.PB_ADMIN_PASSWORD ?? ''; },
    get dataDir() { return envState.dataDir; },
    get googleKey() { return envState.googleKey; },
    get overpassUrl() { return 'http://127.0.0.1:9/'; }
  }
}));
vi.mock('$lib/server/metra', () => ({
  metra: { getSchedule: vi.fn(async () => ({ stations: new Map([['LAGRANGE', { id: 'LAGRANGE', name: 'La Grange Road', lat: 41.8144444, lon: -87.8694444 }]]) })) }
}));
vi.mock('$lib/server/places/google', () => ({
  searchNearby: vi.fn(async () => [
    { source: 'google', id: 'gA', name: 'Alpha Tap', kind: 'bar', lat: 41.8155, lon: -87.8694, address: '1 Main', rating: 4.6, ratingCount: 312, distanceM: 118 },
    { source: 'google', id: 'gB', name: 'Beta Grill', kind: 'restaurant', lat: 41.815, lon: -87.869, distanceM: 70 }
  ]),
  searchText: vi.fn(async () => [{ source: 'google', id: 'gA', name: 'Alpha Tap', kind: 'bar', lat: 41.8155, lon: -87.8694 }]),
  placeDetails: vi.fn(async () => ({
    id: 'gA', name: 'Alpha Tap', address: '1 Main St', lat: 41.8155, lon: -87.8694, hours: ['Saturday: 11:00 AM – 2:00 AM'], rating: 4.6,
    phone: '555-0100', website: 'https://alpha.test', mapsUrl: 'https://maps.google.com/?cid=1',
    photos: [{ name: 'places/gA/photos/p1', attribution: 'Ann' }, { name: 'places/gA/photos/p2', attribution: '' }], fetchedAt: new Date().toISOString()
  })),
  // A minimal valid JPEG header so PocketBase's mime sniffing accepts the upload.
  photoBytes: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]))
}));

import { nearbyForStation } from '$lib/server/places/nearby';
import { attachPlace } from '$lib/server/places/attach';
import { searchNearby, placeDetails, photoBytes } from '$lib/server/places/google';

let crew: { token: string; id: string };
beforeAll(async () => {
  envState.dataDir = mkdtempSync(join(tmpdir(), 'places-hooks-'));
  crew = await loginToken('Places Crew');
});

describe('places store', () => {
  it('stores the nearby venues once and serves the database afterwards', async () => {
    const first = await nearbyForStation('LAGRANGE');
    expect(first.venues.map((v) => v.name)).toEqual(['Alpha Tap', 'Beta Grill']);
    expect(first.venues[0].placeRef).toMatch(/^[a-z0-9]{15}$/);
    const second = await nearbyForStation('LAGRANGE');
    expect(searchNearby).toHaveBeenCalledTimes(1);
    expect(second.venues.map((v) => [v.name, v.rating, v.ratingCount, v.distanceM, v.placeRef])).toEqual(first.venues.map((v) => [v.name, v.rating, v.ratingCount, v.distanceM, v.placeRef]));
    expect(second.venues[1].rating).toBeUndefined();
    const rows = await (await fetch(`${PB}/api/collections/places/records?filter=${encodeURIComponent('station_id="LAGRANGE"')}`, { headers: { Authorization: crew.token } })).json();
    expect(rows.totalItems).toBe(2);
    const lookups = await (await fetch(`${PB}/api/collections/place_lookups/records`, { headers: { Authorization: crew.token } })).json();
    expect(lookups.items.some((l: { station_id: string }) => l.station_id === 'LAGRANGE')).toBe(true);
  });

  it('attaches details and photos to the shared place record and links the stop', async () => {
    const { venues } = await nearbyForStation('LAGRANGE');
    const alpha = venues.find((v) => v.id === 'gA')!;
    const it = await (await post('/api/collections/itineraries/records', { title: 'Places' }, crew.token)).json();
    const stop = await (await post('/api/collections/stops/records', {
      itinerary: it.id, name: alpha.name, kind: 'bar', station_id: 'LAGRANGE', station_name: 'La Grange Road', place: alpha.placeRef, place_id: 'gA', lat: alpha.lat, lon: alpha.lon
    }, crew.token)).json();
    expect(stop.id).toMatch(/^[a-z0-9]{15}$/);

    const result = await attachPlace(stop.id, { is_admin: false });

    expect(result).toEqual({ status: 'done', photos: 2 });
    expect(placeDetails).toHaveBeenCalledTimes(1);
    expect(photoBytes).toHaveBeenCalledTimes(2);
    const place = await (await fetch(`${PB}/api/collections/places/records/${alpha.placeRef}`, { headers: { Authorization: crew.token } })).json();
    expect(place).toMatchObject({ address: '1 Main St', rating: 4.6, phone: '555-0100', maps_url: 'https://maps.google.com/?cid=1', photo_attributions: ['Ann', ''] });
    expect(place.photos).toHaveLength(2);
    expect(place.hours).toEqual({ source: 'google', weekday: ['Saturday: 11:00 AM – 2:00 AM'] });
    const after = await (await fetch(`${PB}/api/collections/stops/records/${stop.id}?expand=place`, { headers: { Authorization: crew.token } })).json();
    expect(after).toMatchObject({ place: alpha.placeRef, photos_status: 'done', address: '1 Main St' });
    expect(after.expand.place.photos).toHaveLength(2);
  });
});

it('stores attributed venue reviews for place details', async () => {
  const response = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }) });
  const { token } = await response.json();
  const reviews = [{ text: 'A review supplied by the venue provider.', author: 'Reviewer', rating: 4, url: 'https://maps.google.com/' }];
  const saved = await fetch(`${PB}/api/collections/places/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ ref: 'google:review-test', source: 'google', name: 'Review test', reviews }) });
  expect(saved.ok).toBe(true);
  expect((await saved.json()).reviews).toEqual(reviews);
});
