import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson } from '../../src/lib/server/places/cache';
import { attachPlace } from '$lib/server/places/attach';
import { searchText, placeDetails, photoBytes } from '$lib/server/places/google';

// Mutable state closed over by the mock factories below (vi.hoisted runs before the mocks and
// before the imports, and the returned object is the same reference used in this file's tests).
const envState = vi.hoisted(() => ({ dataDir: '', googleKey: 'K' }));
type Rec = Record<string, unknown>;
const pbState = vi.hoisted(() => ({
  itineraries: new Map<string, Rec>(),
  stops: new Map<string, Rec>(),
  places: new Map<string, Rec>(),
  nextId: 0
}));

vi.mock('$lib/server/env', () => ({
  serverEnv: {
    get dataDir() { return envState.dataDir; },
    get googleKey() { return envState.googleKey; }
  }
}));

vi.mock('$lib/server/metra', () => ({
  metra: {
    getSchedule: vi.fn(async () => ({
      stations: new Map([['ELMHURST', { id: 'ELMHURST', name: 'Elmhurst', lat: 41.9, lon: -87.94 }]])
    }))
  }
}));

vi.mock('$lib/server/pb', () => ({
  adminPb: vi.fn(async () => ({
    // The real pb.filter() bakes params into a query string; this fake only ever filters places
    // by ref, so returning the ref itself is enough to match records in memory.
    filter: (_raw: string, params: Record<string, unknown>) => String(params.ref ?? params.id),
    collection: (name: string) => {
      const table = name === 'stops' ? pbState.stops : name === 'itineraries' ? pbState.itineraries : name === 'places' ? pbState.places : null;
      if (!table) throw new Error(`unexpected collection ${name}`);
      return {
        getOne: async (id: string) => {
          const r = table.get(id);
          if (!r) throw Object.assign(new Error(`${name} ${id} not found`), { status: 404 });
          return { ...r };
        },
        getFirstListItem: async (ref: string) => {
          const hit = [...table.values()].find((r) => r.ref === ref);
          if (!hit) throw Object.assign(new Error('not found'), { status: 404 });
          return { ...hit };
        },
        create: async (data: Rec) => {
          const rec = { id: `${name}${++pbState.nextId}`, photos: [], ...data };
          table.set(rec.id, rec);
          return { ...rec };
        },
        update: async (id: string, data: Rec | FormData) => {
          const r = table.get(id) ?? { id };
          const patch = data instanceof FormData ? { photos: data.getAll('photos').map((f) => (f as File).name) } : data;
          table.set(id, { ...r, ...patch });
          return { ...table.get(id)! };
        }
      };
    }
  }))
}));

vi.mock('$lib/server/places/google', () => ({
  searchText: vi.fn(),
  placeDetails: vi.fn(),
  photoBytes: vi.fn()
}));

function seedStop(id: string, overrides: Rec = {}) {
  pbState.stops.set(id, {
    id, itinerary: 'draftit', place: '', place_id: '', station_id: 'ELMHURST', station_name: 'Elmhurst', name: 'Test Bar', kind: 'bar',
    lat: 0, lon: 0, address: '', phone: '', website: '', hours: null, photos_status: 'none',
    ...overrides
  });
}
const stop = (id: string) => pbState.stops.get(id) as Rec & { photos_status: string; place: string; place_id: string; address: string };
const place = (id: string) => pbState.places.get(id) as Rec & { photos: string[]; details_at?: string; ref: string };

function meta(photoCount: number) {
  return {
    id: 'place1', name: 'Test Bar', address: '1 Main St', lat: 41.9, lon: -87.94,
    hours: ['Saturday: 11:00 AM – 2:00 AM'], rating: 4.4, phone: '555-0100', website: 'https://example.test', mapsUrl: 'https://maps.google.com/?cid=1',
    photos: Array.from({ length: photoCount }, (_, i) => ({ name: `places/place1/photos/p${i + 1}`, attribution: 'Ann' })),
    fetchedAt: new Date().toISOString()
  };
}

beforeEach(() => {
  pbState.itineraries.clear();
  pbState.itineraries.set('draftit', { id: 'draftit', status: 'draft' });
  pbState.itineraries.set('lockedit', { id: 'lockedit', status: 'locked' });
  pbState.stops.clear();
  pbState.places.clear();
  pbState.nextId = 0;
  envState.dataDir = mkdtempSync(join(tmpdir(), 'attach-'));
  envState.googleKey = 'K';
  vi.mocked(searchText).mockReset().mockResolvedValue([{ source: 'google', id: 'place1', name: 'Test Bar', kind: 'bar', lat: 41.9, lon: -87.94 }]);
  vi.mocked(placeDetails).mockReset().mockResolvedValue(meta(2));
  vi.mocked(photoBytes).mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('attachPlace', () => {
  it('fails without photos when the photo budget is already exhausted, keeping the details it got', async () => {
    seedStop('stop1');
    await writeJson(join(envState.dataDir, 'places', 'budget.json'), { month: new Date().toISOString().slice(0, 7), details: 0, photos: 800 });

    const result = await attachPlace('stop1');

    expect(result).toMatchObject({ status: 'failed', photos: 0 });
    expect(stop('stop1').photos_status).toBe('failed');
    expect(photoBytes).not.toHaveBeenCalled();
    const [p] = [...pbState.places.values()];
    expect(p.details_at).toBeTruthy();
    expect(p.photos).toEqual([]);
    expect(p.photo_refs).toEqual(['places/place1/photos/p1', 'places/place1/photos/p2']);
  });

  it('reports a failed attach instead of rejecting when the stop does not exist', async () => {
    // The route validates the id shape only, so a well-formed id for a deleted stop reaches here;
    // rejecting would escape the queue chain and take the Node server down.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await attachPlace('doesnotexist000');

    expect(result).toMatchObject({ status: 'failed', photos: 0 });
    expect(result.message).toBeTruthy();
    expect(searchText).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('refuses a non-admin caller once the itinerary has left draft, and writes nothing', async () => {
    seedStop('stop4', { itinerary: 'lockedit' });

    await expect(attachPlace('stop4', { is_admin: false })).rejects.toMatchObject({ status: 403 });

    expect(stop('stop4').photos_status).toBe('none');
    expect(searchText).not.toHaveBeenCalled();
    expect(pbState.places.size).toBe(0);
  });

  it('lets the crew attach on a draft and the admin attach on a locked itinerary', async () => {
    seedStop('stop5');
    seedStop('stop6', { itinerary: 'lockedit' });

    expect((await attachPlace('stop5', { is_admin: false })).status).toBe('done');
    expect((await attachPlace('stop6', { is_admin: true })).status).toBe('done');
  });

  it('refuses a place_id that is not a plain Google id', async () => {
    seedStop('stop7', { place_id: '../../../etc/passwd' });

    const result = await attachPlace('stop7');

    expect(result).toMatchObject({ status: 'failed', photos: 0, message: 'Unexpected Google place id.' });
    expect(placeDetails).not.toHaveBeenCalled();
    expect(photoBytes).not.toHaveBeenCalled();
  });

  it('stores details and photos on one place record and points the stop at it', async () => {
    seedStop('stop8');

    const result = await attachPlace('stop8');

    expect(result).toEqual({ status: 'done', photos: 2 });
    expect(pbState.places.size).toBe(1);
    const [p] = [...pbState.places.values()];
    expect(p).toMatchObject({ ref: 'google:place1', source: 'google', place_id: 'place1', address: '1 Main St', rating: 4.4, phone: '555-0100', maps_url: 'https://maps.google.com/?cid=1', photos: ['1.jpg', '2.jpg'], photo_attributions: ['Ann', 'Ann'] });
    expect(p.hours).toEqual({ source: 'google', weekday: ['Saturday: 11:00 AM – 2:00 AM'] });
    expect(stop('stop8')).toMatchObject({ place: p.id, place_id: 'place1', address: '1 Main St', photos_status: 'done' });
  });

  it('serializes two concurrent attaches for the same stop so Google is called once', async () => {
    seedStop('stop2');

    const [r1, r2] = await Promise.all([attachPlace('stop2'), attachPlace('stop2')]);

    expect(r1.status).toBe('done');
    expect(r2.status).toBe('done');
    expect(pbState.places.size).toBe(1);
    expect(searchText).toHaveBeenCalledTimes(1);
    expect(placeDetails).toHaveBeenCalledTimes(1);
    expect(photoBytes).toHaveBeenCalledTimes(2);
  });

  it('shares one venue between two stops: details and photos are fetched once', async () => {
    seedStop('stop9', { place_id: 'place1' });
    seedStop('stop10', { place_id: 'place1', itinerary: 'draftit' });

    const [r1, r2] = await Promise.all([attachPlace('stop9'), attachPlace('stop10')]);

    expect(r1).toEqual({ status: 'done', photos: 2 });
    expect(r2).toEqual({ status: 'done', photos: 2 });
    expect(pbState.places.size).toBe(1);
    expect(placeDetails).toHaveBeenCalledTimes(1);
    expect(photoBytes).toHaveBeenCalledTimes(2);
    expect(stop('stop9').place).toBe(stop('stop10').place);
  });

  it('re-points an OpenStreetMap-sourced stop at the Google record found by name', async () => {
    pbState.places.set('osmrec', { id: 'osmrec', ref: 'osm:node/1', source: 'osm', osm_id: 'node/1', place_id: '', name: 'Test Bar', photos: [] });
    seedStop('stop11', { place: 'osmrec', osm_id: 'node/1' });

    const result = await attachPlace('stop11');

    expect(result.status).toBe('done');
    expect(searchText).toHaveBeenCalledTimes(1);
    const google = [...pbState.places.values()].find((p) => p.ref === 'google:place1')!;
    expect(google).toBeTruthy();
    expect(stop('stop11').place).toBe(google.id);
    expect(place('osmrec').photos).toEqual([]);
  });

  it('makes no Google calls on a second sequential call once done', async () => {
    seedStop('stop3');

    const first = await attachPlace('stop3');
    expect(first.status).toBe('done');
    vi.mocked(searchText).mockClear();
    vi.mocked(placeDetails).mockClear();
    vi.mocked(photoBytes).mockClear();

    const second = await attachPlace('stop3');

    expect(second).toEqual({ status: 'done', photos: 2 });
    expect(searchText).not.toHaveBeenCalled();
    expect(placeDetails).not.toHaveBeenCalled();
    expect(photoBytes).not.toHaveBeenCalled();
  });
});
