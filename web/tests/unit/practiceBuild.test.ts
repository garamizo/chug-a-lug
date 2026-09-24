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
  const rows: Record<string, Record<string, unknown>[]> = { itineraries: [], stops: [], legs: [] };
  let current = '';
  const api = {
    rows, get current() { return current; },
    async list(c: string, f: (r: Record<string, unknown>) => boolean) { return rows[c].filter(f); },
    async create(c: string, body: Record<string, unknown>) {
      const row = { id: `${c}${++n}`, ...body, ...(c === 'itineraries' ? { status: 'draft' } : {}) };
      rows[c].push(row);
      // The recompute hook runs on drafts: a stop write produces the legs between stops.
      if (c === 'stops' && legKind && rows.stops.length > 1) rows.legs.push({ itinerary: body.itinerary, kind: legKind });
      return row;
    },
    async update(c: string, id: string, body: Record<string, unknown>) { Object.assign(rows[c].find((r) => r.id === id)!, body); },
    async remove(c: string, id: string) { rows[c] = rows[c].filter((r) => r.id !== id && r.itinerary !== id); },
    async getSettings() { return { current_itinerary: current }; },
    async setCurrent(id: string) { current = id; }
  };
  return api;
}

describe('buildCannedRoute', () => {
  it('locks and selects the route only after every leg is a train or a walk', async () => {
    const api = fakeApi('train');
    const { id } = await buildCannedRoute(api, stops, opts);
    expect(api.rows.itineraries.find((r) => r.id === id)?.status).toBe('locked');
    expect(api.current).toBe(id);
  });
  it('leaves an impossible route as a draft that nobody sees', async () => {
    const api = fakeApi('impossible');
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/impossible/i);
    expect(api.rows.itineraries[0].status).toBe('draft');
    expect(api.current).toBe('');
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
  it('does not take over from a route the Conductor already selected', async () => {
    const api = fakeApi('train');
    await api.setCurrent('real');
    await buildCannedRoute(api, stops, opts);
    expect(api.current).toBe('real');
  });
});
