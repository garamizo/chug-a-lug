import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, get, loginToken, patch, post, superuserToken, truncate } from './setup';

let owner: { token: string; id: string };
let cloner: { token: string; id: string };
let admin: { token: string; id: string };
let source: { id: string; title: string };
let n = 0;
const newId = () => `clonetest${String(++n).padStart(6, '0')}`;
const clone = (token: string, body: Record<string, unknown>) => post('/api/crawl/clone', body, token);
const list = async (collection: string, filter: string, token: string) =>
  (await (await get(`/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(filter)}`, token)).json()).items;

beforeAll(async () => {
  owner = await loginToken('Clone Owner');
  cloner = await loginToken('Clone Taker');
  admin = await loginToken('Clone Boss', ADMIN_LOGIN_PASSWORD);
});

beforeEach(async () => {
  for (const c of ['comments', 'legs', 'stops', 'itineraries']) await truncate(c);
  const it = await (await post('/api/collections/itineraries/records', { title: 'Loop Crawl', event_date: '2026-12-26', start_time: '11:30', start_station: 'CUS', start_station_name: 'Union Station' }, owner.token)).json();
  await post('/api/collections/stops/records', { itinerary: it.id, order: 1, name: 'The Hop Haus', kind: 'bar', direction: 'out', station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 75, walk_min: 4, notes: 'upstairs', meet_point: 'bar', osm_id: 'node/1' }, owner.token);
  await post('/api/collections/stops/records', { itinerary: it.id, order: 2, name: 'Berwyn Diner', kind: 'restaurant', direction: 'back', station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 5 }, owner.token);
  await patch(`/api/collections/itineraries/records/${it.id}`, { status: 'locked' }, admin.token);
  source = { id: it.id, title: 'Loop Crawl' };
});

describe('POST /api/crawl/clone', () => {
  it('makes a draft of the caller\'s own with the stops and a note on both routes', async () => {
    const id = newId();
    const res = await clone(cloner.token, { source: source.id, id, title: 'Copy of Loop Crawl' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, title: 'Copy of Loop Crawl' });
    const it = await (await get(`/api/collections/itineraries/records/${id}`, cloner.token)).json();
    expect(it).toMatchObject({ status: 'draft', created_by: cloner.id, vote_open: false, title_key: 'copy of loop crawl', event_date: '2026-12-26', start_time: '11:30', start_station: 'CUS', start_station_name: 'Union Station' });
    const stops = await list('stops', `itinerary="${id}"`, cloner.token);
    expect(stops.map((s: { name: string }) => s.name).sort()).toEqual(['Berwyn Diner', 'The Hop Haus']);
    expect(stops.find((s: { name: string }) => s.name === 'The Hop Haus')).toMatchObject({ order: 1, kind: 'bar', direction: 'out', dwell_min: 75, notes: 'upstairs', meet_point: 'bar', osm_id: 'node/1', photos_status: 'none' });
    const from = await list('comments', `target_id="${id}"`, cloner.token);
    expect(from).toHaveLength(1);
    expect(from[0]).toMatchObject({ kind: 'cloned_from', user: cloner.id, meta: { route: source.id, title: 'Loop Crawl' } });
    const to = await list('comments', `target_id="${source.id}"`, cloner.token);
    expect(to).toHaveLength(1);
    expect(to[0]).toMatchObject({ kind: 'cloned_to', user: cloner.id, meta: { route: id, title: 'Copy of Loop Crawl' } });
    // The source is untouched apart from its note.
    expect((await (await get(`/api/collections/itineraries/records/${source.id}`, cloner.token)).json()).status).toBe('locked');
  });

  it('a retry, even overlapping, returns the one clone and writes nothing more', async () => {
    const id = newId();
    const body = { source: source.id, id, title: 'Copy of Loop Crawl' };
    const [a, b] = await Promise.all([clone(cloner.token, body), clone(cloner.token, body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await clone(cloner.token, { ...body, title: 'Copy of Loop Crawl (2)' })).status).toBe(200);
    expect(await list('stops', `itinerary="${id}"`, cloner.token)).toHaveLength(2);
    expect(await list('comments', `target_id="${source.id}"`, cloner.token)).toHaveLength(1);
    expect(await list('itineraries', `title_key~"copy of"`, cloner.token)).toHaveLength(1);
  });

  it('never touches an existing route that is not this clone', async () => {
    const mine = await (await post('/api/collections/itineraries/records', { title: 'Mine locked' }, cloner.token)).json();
    await patch(`/api/collections/itineraries/records/${mine.id}`, { status: 'locked' }, admin.token);
    expect((await clone(cloner.token, { source: source.id, id: mine.id, title: 'Copy of Loop Crawl' })).status).toBe(409);
    expect((await (await get(`/api/collections/itineraries/records/${mine.id}`, cloner.token)).json()).status).toBe('locked');
    expect((await clone(cloner.token, { source: source.id, id: source.id, title: 'Copy of Loop Crawl' })).status).toBe(400);
    expect(await list('stops', `itinerary="${source.id}"`, cloner.token)).toHaveLength(2);
  });

  it('refuses a taken or invalid name, a missing source and no login, creating nothing', async () => {
    const id = newId();
    const taken = await clone(cloner.token, { source: source.id, id, title: 'LOOP  crawl' });
    expect(taken.status).toBe(400);
    // PocketBase sentence-cases the message on the wire ("Title_taken."); undo that to compare codes.
    const code = (message: string) => message.toLowerCase().replace(/\.$/, '');
    expect(code((await taken.json()).message)).toBe('title_taken');
    expect(code((await (await clone(cloner.token, { source: source.id, id, title: ' ' })).json()).message)).toBe('title_invalid');
    expect((await clone(cloner.token, { source: 'missingroute001', id, title: 'Copy of X' })).status).toBe(404);
    expect((await clone('', { source: source.id, id, title: 'Copy of X' })).status).toBe(401);
    expect((await get(`/api/collections/itineraries/records/${id}`, cloner.token)).status).toBe(404);
  });

  it('is all or nothing: a failing note leaves no clone behind', async () => {
    const su = await superuserToken();
    const col = await (await get('/api/collections/comments', su)).json();
    const id = newId();
    await patch('/api/collections/comments', { fields: [...col.fields, { name: 'zz_required', type: 'text', required: true }] }, su);
    try {
      expect((await clone(cloner.token, { source: source.id, id, title: 'Copy of Loop Crawl' })).status).toBeGreaterThanOrEqual(400);
    } finally {
      await patch('/api/collections/comments', { fields: col.fields }, su);
    }
    expect((await get(`/api/collections/itineraries/records/${id}`, cloner.token)).status).toBe(404);
    expect(await list('stops', `itinerary="${id}"`, su)).toHaveLength(0);
  });
});
