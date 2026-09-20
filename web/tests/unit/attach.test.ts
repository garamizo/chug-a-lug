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
const pbState = vi.hoisted(() => ({
  itineraries: new Map<string, Record<string, unknown>>(),
  stops: new Map<string, Record<string, unknown>>(),
  stopPhotos: [] as { id: string; stop: string; source: string; attribution: string }[],
  createCalls: [] as { stop: string; attribution: string }[],
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
    // The real pb.filter() bakes params into a query string; for this fake we only ever filter
    // stop_photos by stop id, so returning the id itself is enough to match records in-memory.
    filter: (_raw: string, params: Record<string, unknown>) => String(params.id),
    collection: (name: string) => {
      if (name === 'stops') {
        return {
          getOne: async (id: string) => {
            const s = pbState.stops.get(id);
            if (!s) throw new Error(`stop ${id} not found`);
            return { ...s };
          },
          update: async (id: string, data: Record<string, unknown>) => {
            const s = pbState.stops.get(id) ?? { id };
            pbState.stops.set(id, { ...s, ...data });
            return pbState.stops.get(id);
          }
        };
      }
      if (name === 'itineraries') {
        return {
          getOne: async (id: string) => {
            const it = pbState.itineraries.get(id);
            if (!it) throw new Error(`itinerary ${id} not found`);
            return { ...it };
          }
        };
      }
      if (name === 'stop_photos') {
        return {
          getFullList: async (opts: { filter: string }) =>
            pbState.stopPhotos.filter((p) => p.stop === opts.filter).map((p) => ({ id: p.id })),
          create: async (form: FormData) => {
            const rec = {
              id: `photo${++pbState.nextId}`,
              stop: String(form.get('stop')),
              source: String(form.get('source')),
              attribution: String(form.get('attribution'))
            };
            pbState.stopPhotos.push(rec);
            pbState.createCalls.push({ stop: rec.stop, attribution: rec.attribution });
            return rec;
          }
        };
      }
      throw new Error(`unexpected collection ${name}`);
    }
  }))
}));

vi.mock('$lib/server/places/google', () => ({
  searchText: vi.fn(),
  placeDetails: vi.fn(),
  photoBytes: vi.fn()
}));

function seedStop(id: string, overrides: Record<string, unknown> = {}) {
  pbState.stops.set(id, {
    id, itinerary: 'draftit', place_id: '', station_id: 'ELMHURST', station_name: 'Elmhurst', name: 'Test Bar',
    lat: 0, lon: 0, address: '', phone: '', website: '', hours: null, photos_status: 'none',
    ...overrides
  });
}

function meta(photoCount: number) {
  return {
    id: 'place1', name: 'Test Bar', address: '1 Main St', lat: 41.9, lon: -87.94,
    hours: [], phone: '555-0100', website: 'https://example.test', mapsUrl: 'https://maps.google.com/?cid=1',
    photos: Array.from({ length: photoCount }, (_, i) => ({ name: `places/place1/photos/p${i + 1}`, attribution: 'Ann' })),
    fetchedAt: new Date().toISOString()
  };
}

beforeEach(() => {
  pbState.itineraries.clear();
  pbState.itineraries.set('draftit', { id: 'draftit', status: 'draft' });
  pbState.itineraries.set('lockedit', { id: 'lockedit', status: 'locked' });
  pbState.stops.clear();
  pbState.stopPhotos.length = 0;
  pbState.createCalls.length = 0;
  pbState.nextId = 0;
  envState.dataDir = mkdtempSync(join(tmpdir(), 'attach-'));
  envState.googleKey = 'K';
  vi.mocked(searchText).mockReset().mockResolvedValue([{ source: 'google', id: 'place1', name: 'Test Bar', kind: 'bar', lat: 41.9, lon: -87.94 }]);
  vi.mocked(placeDetails).mockReset().mockResolvedValue(meta(2));
  vi.mocked(photoBytes).mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('attachPlace', () => {
  it('fails without creating photos when the photo budget is already exhausted', async () => {
    seedStop('stop1');
    await writeJson(join(envState.dataDir, 'places', 'budget.json'), { month: new Date().toISOString().slice(0, 7), details: 0, photos: 800 });

    const result = await attachPlace('stop1');

    expect(result.status).toBe('failed');
    expect(result.photos).toBe(0);
    expect((pbState.stops.get('stop1') as { photos_status: string }).photos_status).toBe('failed');
    expect(pbState.stopPhotos).toHaveLength(0);
    expect(photoBytes).not.toHaveBeenCalled();
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

    expect((pbState.stops.get('stop4') as { photos_status: string }).photos_status).toBe('none');
    expect(searchText).not.toHaveBeenCalled();
    expect(pbState.stopPhotos).toHaveLength(0);
  });

  it('lets the crew attach on a draft and the admin attach on a locked itinerary', async () => {
    seedStop('stop5');
    seedStop('stop6', { itinerary: 'lockedit' });

    expect((await attachPlace('stop5', { is_admin: false })).status).toBe('done');
    expect((await attachPlace('stop6', { is_admin: true })).status).toBe('done');
  });

  it('refuses a place_id that is not a plain Google id before it becomes a path segment', async () => {
    seedStop('stop7', { place_id: '../../../etc/passwd' });

    const result = await attachPlace('stop7');

    expect(result).toMatchObject({ status: 'failed', photos: 0, message: 'Unexpected Google place id.' });
    expect(placeDetails).not.toHaveBeenCalled();
    expect(photoBytes).not.toHaveBeenCalled();
  });

  it('serializes two concurrent attaches for the same stop so photos are created once', async () => {
    seedStop('stop2');

    const [r1, r2] = await Promise.all([attachPlace('stop2'), attachPlace('stop2')]);

    expect(r1.status).toBe('done');
    expect(r2.status).toBe('done');
    expect(pbState.createCalls).toHaveLength(2);
    expect(pbState.stopPhotos.filter((p) => p.stop === 'stop2')).toHaveLength(2);
    expect(searchText).toHaveBeenCalledTimes(1);
    expect(placeDetails).toHaveBeenCalledTimes(1);
    expect(photoBytes).toHaveBeenCalledTimes(2);
  });

  it('makes no Google calls on a second sequential call once done', async () => {
    seedStop('stop3');

    const first = await attachPlace('stop3');
    expect(first.status).toBe('done');
    vi.mocked(searchText).mockClear();
    vi.mocked(placeDetails).mockClear();
    vi.mocked(photoBytes).mockClear();

    const second = await attachPlace('stop3');

    expect(second.status).toBe('done');
    expect(second.photos).toBe(first.photos);
    expect(searchText).not.toHaveBeenCalled();
    expect(placeDetails).not.toHaveBeenCalled();
    expect(photoBytes).not.toHaveBeenCalled();
    expect(pbState.createCalls).toHaveLength(2);
  });
});
