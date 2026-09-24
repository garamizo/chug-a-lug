import { describe, expect, it } from 'vitest';
import { buildCannedRoute } from '../../scripts/practice-build.mjs';

const TITLE = 'Out and back on the BNSF — practice crawl';
const stops = [{ name: 'A bar', kind: 'bar', station_id: 'AURORA' }, { name: 'B bar', kind: 'bar', station_id: 'NAPERVILLE' }];
const opts = { title: TITLE, eventDate: '2026-10-03', startTime: '11:00', ownerId: 'u1', timeoutMs: 50, pollMs: 5 };

// Real PocketBase ids never collide. `n` is module-level (not per-fakeApi) so two independent
// fakeApi() instances in the same test — an abandoned draft's api and its replacement's — hand out
// distinct ids too, the way separate PocketBase creates would, instead of both starting over at 1.
let n = 0;
function fakeApi(legKind: 'train' | 'impossible' | null) {
  const rows: Record<string, Record<string, unknown>[]> = { itineraries: [], stops: [], legs: [], places: [] };
  const setCurrentCalls: string[] = [];
  const api = {
    rows, setCurrentCalls,
    // `filter` is the server-side PocketBase filter clause the real adapter sends; the fake keeps
    // filtering purely by predicate, but accepts the third argument so both share one call shape.
    async list(c: string, f: (r: Record<string, unknown>) => boolean, _filter?: string) { return rows[c].filter(f); },
    async create(c: string, body: Record<string, unknown>) {
      // Real PocketBase enforces `idx_places_ref` as a unique index; a regression that re-creates a
      // place PocketBase already has must fail here the way it fails against the real database.
      if (c === 'places' && body.ref !== undefined && rows.places.some((p) => p.ref === body.ref)) {
        throw new Error(`fakeApi: duplicate places.ref "${body.ref}" (idx_places_ref would reject this)`);
      }
      const row = { id: `${c}${++n}`, ...body, ...(c === 'itineraries' ? { status: 'draft' } : {}) };
      rows[c].push(row);
      // The recompute hook runs on drafts: a stop write produces the legs between stops.
      if (c === 'stops' && legKind && rows.stops.length > 1) rows.legs.push({ itinerary: body.itinerary, kind: legKind });
      return row;
    },
    async update(c: string, id: string, body: Record<string, unknown>) { Object.assign(rows[c].find((r) => r.id === id)!, body); },
    async remove(c: string, id: string) { rows[c] = rows[c].filter((r) => r.id !== id && r.itinerary !== id); },
    // Left in the fake so a test can still assert the build never reaches for it (fix 2: the canned
    // script no longer sets `current_itinerary` itself; the newest-locked fallback handles that).
    async setCurrent(id: string) { setCurrentCalls.push(id); }
  };
  return api;
}

describe('buildCannedRoute', () => {
  it('locks the route once every leg is a train or a walk, and never touches current_itinerary', async () => {
    const api = fakeApi('train');
    const { id } = await buildCannedRoute(api, stops, opts);
    expect(api.rows.itineraries.find((r) => r.id === id)?.status).toBe('locked');
    expect(api.setCurrentCalls).toHaveLength(0);
  });
  it('leaves an impossible route as a draft that nobody sees', async () => {
    const api = fakeApi('impossible');
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/impossible/i);
    expect(api.rows.itineraries[0].status).toBe('draft');
    expect(api.setCurrentCalls).toHaveLength(0);
  });
  it('leaves a draft when the planner never answers', async () => {
    const api = fakeApi(null);
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/timed out/i);
    expect(api.rows.itineraries[0].status).toBe('draft');
  });
  it('replaces its own abandoned draft on a second run', async () => {
    const api = fakeApi('impossible');
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow();
    const failed = api.rows.itineraries[0].id;
    const again = fakeApi('train');
    again.rows.itineraries.push(...api.rows.itineraries);
    await buildCannedRoute(again, stops, opts);
    expect(again.rows.itineraries.map((r) => r.id)).not.toContain(failed);
    expect(again.rows.itineraries).toHaveLength(1);
  });
  it('refuses when a locked canned route already exists', async () => {
    const api = fakeApi('train');
    api.rows.itineraries.push({ id: 'old', title: TITLE, status: 'locked' });
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/already exists/i);
  });
  it('leaves an archived canned route alone: it neither blocks the run nor gets deleted', async () => {
    const api = fakeApi('train');
    api.rows.itineraries.push({ id: 'old-archived', title: TITLE, status: 'archived' });
    const { id } = await buildCannedRoute(api, stops, opts);
    expect(api.rows.itineraries.find((r) => r.id === 'old-archived')).toBeDefined();
    expect(api.rows.itineraries.find((r) => r.id === id)?.status).toBe('locked');
    expect(api.rows.itineraries).toHaveLength(2);
  });
  it('removes only its own leftover draft rows with the title, not an archived one', async () => {
    const api = fakeApi('impossible');
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow();
    const failedDraftId = api.rows.itineraries[0].id;
    api.rows.itineraries.push({ id: 'archived-old', title: TITLE, status: 'archived' });
    const again = fakeApi('train');
    again.rows.itineraries.push(...api.rows.itineraries);
    await buildCannedRoute(again, stops, opts);
    expect(again.rows.itineraries.map((r) => r.id)).not.toContain(failedDraftId);
    expect(again.rows.itineraries.find((r) => r.id === 'archived-old')).toBeDefined();
  });
  it('stamps a place record with details_at, and never sends place-only fields to stops', async () => {
    const api = fakeApi('train');
    const stopsWithPlace = [
      { name: 'A bar', kind: 'bar', station_id: 'AURORA', place_id: 'g1', rating: 4.6, fetched_at: '2026-09-24T12:00:00.000Z' },
      { name: 'B bar', kind: 'bar', station_id: 'NAPERVILLE' }
    ];
    await buildCannedRoute(api, stopsWithPlace, opts);
    expect(api.rows.places).toHaveLength(1);
    expect(api.rows.places[0].details_at).toBe('2026-09-24T12:00:00.000Z');
    expect(api.rows.places[0].place_id).toBe('g1');
    expect(api.rows.stops[0].rating).toBeUndefined(); // place-only field, whitelisted away from stops
  });
  it('reuses an existing place with the same ref instead of creating a duplicate, and does not modify it', async () => {
    const api = fakeApi('train');
    api.rows.places.push({ id: 'places-existing', ref: 'google:g1', place_id: 'g1', name: 'Real-route name', rating: 4.9, source: 'google' });
    const stopsWithPlace = [
      { name: 'A bar', kind: 'bar', station_id: 'AURORA', place_id: 'g1', rating: 4.6, fetched_at: '2026-09-24T12:00:00.000Z' },
      { name: 'B bar', kind: 'bar', station_id: 'NAPERVILLE' }
    ];
    await buildCannedRoute(api, stopsWithPlace, opts);
    expect(api.rows.places).toHaveLength(1); // no new row created
    expect(api.rows.places[0].name).toBe('Real-route name'); // untouched: a real-route stop may share it
    expect(api.rows.places[0].rating).toBe(4.9);
    expect(api.rows.stops[0].place).toBe('places-existing');
  });
  it('reuses places a failed run already created, on a successful re-run, without a duplicate ref', async () => {
    const api = fakeApi('impossible');
    const stopsWithPlace = [
      { name: 'A bar', kind: 'bar', station_id: 'AURORA', place_id: 'g1', fetched_at: 't1' },
      { name: 'B bar', kind: 'bar', station_id: 'NAPERVILLE', place_id: 'g2', fetched_at: 't2' }
    ];
    await expect(buildCannedRoute(api, stopsWithPlace, opts)).rejects.toThrow();
    expect(api.rows.places).toHaveLength(2);
    const again = fakeApi('train');
    again.rows.itineraries.push(...api.rows.itineraries);
    again.rows.places.push(...api.rows.places);
    await buildCannedRoute(again, stopsWithPlace, opts);
    const refs = again.rows.places.map((p) => p.ref);
    expect(refs).toEqual(['google:g1', 'google:g2']); // reused, not duplicated
    expect(again.rows.places).toHaveLength(2);
  });
});
