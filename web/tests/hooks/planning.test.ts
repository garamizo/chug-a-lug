import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, del, get, loginToken, patch, post, superuserToken, truncate } from './setup';

let crew: { token: string; id: string };
let other: { token: string; id: string };
let admin: { token: string; id: string };

let titleSeq = 0;
const createItinerary = (token: string, body: Record<string, unknown> = {}) =>
  post('/api/collections/itineraries/records', { title: `Test draft ${++titleSeq}`, ...body }, token);

const createStop = (token: string, itinerary: string, body: Record<string, unknown> = {}) =>
  post('/api/collections/stops/records', { itinerary, name: 'Test Tavern', station_id: 'ELMHURST', station_name: 'Elmhurst', ...body }, token);

beforeAll(async () => {
  crew = await loginToken('Plan Crew');
  other = await loginToken('Plan Other');
  admin = await loginToken('Plan Boss', ADMIN_LOGIN_PASSWORD);
  for (const c of ['legs', 'event_log', 'approval_votes', 'comments', 'votes', 'stops', 'itineraries']) await truncate(c);
});

describe('itineraries', () => {
  it('creates as draft owned by the caller with defaults, ignoring privileged fields', async () => {
    const res = await createItinerary(crew.token, { status: 'locked', created_by: other.id, vote_open: true });
    expect(res.status).toBe(200);
    const record = await res.json();
    expect(record.status).toBe('draft');
    expect(record.created_by).toBe(crew.id);
    expect(record.vote_open).toBe(false);
    expect(record.event_date).toBe('2026-12-26');
    expect(record.start_time).toBe('11:00');
  });

  it('lets the owner rename but not lock; admin can lock and it is logged', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Renamed by owner' }, crew.token)).status).toBe(200);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { vote_open: true }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Nope from other' }, other.token)).status).toBe(404);
    const locked = await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect(locked.status).toBe(200);
    expect((await locked.json()).locked_at).toBeTruthy();
    const log = await get(`/api/collections/event_log/records?filter=${encodeURIComponent(`itinerary="${id}" && kind="locked"`)}`, crew.token);
    expect((await log.json()).totalItems).toBe(1);
  });

  it('locking a second itinerary for the same date archives the first', async () => {
    const a = await (await createItinerary(admin.token, { title: 'A' })).json();
    const b = await (await createItinerary(admin.token, { title: 'B' })).json();
    await patch(`/api/collections/itineraries/records/${a.id}`, { status: 'locked' }, admin.token);
    await patch(`/api/collections/itineraries/records/${b.id}`, { status: 'locked' }, admin.token);
    const again = await (await get(`/api/collections/itineraries/records/${a.id}`, crew.token)).json();
    expect(again.status).toBe('archived');
  });

  it('freezes a locked itinerary for its creator; the admin can edit it and unlock it', async () => {
    const { id } = await (await createItinerary(crew.token, { title: 'Frozen 1' })).json();
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_time: '12:00' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Renamed frozen' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { event_date: '2026-12-27' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_station: 'AURORA', start_station_name: 'Aurora' }, crew.token)).status).toBe(403);
    // A no-op write of the same values is not an edit, so it still goes through.
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Frozen 1' }, crew.token)).status).toBe(200);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_time: '12:00' }, admin.token)).status).toBe(200);
    const back = await patch(`/api/collections/itineraries/records/${id}`, { status: 'draft' }, admin.token);
    expect(back.status).toBe(200);
    expect((await back.json()).locked_at).toBe('');
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_time: '12:30' }, crew.token)).status).toBe(200);
  });

  it('builder deletes only their draft; the Conductor deletes any route in any status', async () => {
    const { id: draft } = await (await createItinerary(crew.token)).json();
    expect((await del(`/api/collections/itineraries/records/${draft}`, other.token)).status).toBe(404);
    expect((await del(`/api/collections/itineraries/records/${draft}`, crew.token)).status).toBe(204);

    const { id: locked } = await (await createItinerary(crew.token)).json();
    await patch(`/api/collections/itineraries/records/${locked}`, { status: 'locked' }, admin.token);
    expect((await del(`/api/collections/itineraries/records/${locked}`, crew.token)).status).toBe(404);
    expect((await del(`/api/collections/itineraries/records/${locked}`, admin.token)).status).toBe(204);

    const { id: othersDraft } = await (await createItinerary(other.token)).json();
    expect((await del(`/api/collections/itineraries/records/${othersDraft}`, admin.token)).status).toBe(204);
  });

  it('stores a start station and accepts an opening leg with no from_stop', async () => {
    const { id } = await (await createItinerary(crew.token, { title: 'Boarding' })).json();
    const set = await patch(`/api/collections/itineraries/records/${id}`, { start_station: 'AURORA', start_station_name: 'Aurora' }, crew.token);
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ start_station: 'AURORA', start_station_name: 'Aurora' });
    const { id: stop } = await (await createStop(crew.token, id)).json();
    const su = await superuserToken();
    const leg = await post('/api/collections/legs/records', { itinerary: id, from_stop: '', to_stop: stop, kind: 'train' }, su);
    expect(leg.status).toBe(200);
  });

  it('deleting the current route clears crawl_settings.current_itinerary', async () => {
    const su = await superuserToken();
    const { id } = await (await createItinerary(admin.token, { title: 'Current' })).json();
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    const settings = await (await get('/api/collections/crawl_settings/records?perPage=1', su)).json();
    const sid = settings.items[0]?.id;
    expect(sid).toBeTruthy();
    expect((await patch(`/api/collections/crawl_settings/records/${sid}`, { current_itinerary: id }, su)).status).toBe(200);
    expect((await del(`/api/collections/itineraries/records/${id}`, admin.token)).status).toBe(204);
    const after = await (await get(`/api/collections/crawl_settings/records/${sid}`, su)).json();
    expect(after.current_itinerary).toBe('');
  });

  it('names are unique ignoring case and spaces, 1–80 characters, stored trimmed', async () => {
    const a = await (await createItinerary(crew.token, { title: '  Unique Loop ' })).json();
    expect(a.title).toBe('Unique Loop');
    expect(a.title_key).toBe('unique loop');
    const dup = await createItinerary(other.token, { title: 'unique   LOOP' });
    expect(dup.status).toBe(400);
    // PocketBase sentenizes ApiError messages (capitalizes, appends a period), so the code
    // arrives on the wire as `Title_taken.`; web/src/lib/routeTitle.ts's titleError() undoes that.
    expect((await dup.json()).message).toBe('Title_taken.');
    expect((await (await createItinerary(crew.token, { title: '   ' })).json()).message).toBe('Title_invalid.');
    const b = await (await createItinerary(crew.token, { title: 'Unique Other' })).json();
    const clash = await patch(`/api/collections/itineraries/records/${b.id}`, { title: 'UNIQUE LOOP' }, crew.token);
    expect(clash.status).toBe(400);
    expect((await clash.json()).message).toBe('Title_taken.');
    // Keeping your own name (even re-cased) is not a clash.
    expect((await patch(`/api/collections/itineraries/records/${a.id}`, { title: 'Unique loop' }, crew.token)).status).toBe(200);
    // A forged title_key is overwritten from the title.
    const forged = await (await patch(`/api/collections/itineraries/records/${b.id}`, { title_key: 'zzz' }, crew.token)).json();
    expect(forged.title_key).toBe('unique other');
  });

  it('racing requests cannot both take a free name', async () => {
    const creates = await Promise.all(Array.from({ length: 5 }, () => createItinerary(crew.token, { title: 'Race name' })));
    expect(creates.filter((r) => r.status === 200)).toHaveLength(1);
    const [x, y] = await Promise.all([createItinerary(crew.token), createItinerary(crew.token)].map(async (p) => (await p).json()));
    const renames = await Promise.all([x, y].map((r) => patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Race rename' }, crew.token)));
    expect(renames.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe('stops', () => {
  it('only the builder or the Conductor can write stops on a draft; only the Conductor once locked', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    // Someone else's draft: create fails the rule (400); update/delete are filtered out (404).
    expect((await createStop(other.token, id)).status).toBe(400);
    const res = await createStop(crew.token, id);
    expect(res.status).toBe(200);
    const stop = await res.json();
    expect(stop.dwell_min).toBe(60);
    expect(stop.kind).toBe('bar');
    expect(stop.photos_status).toBe('none');
    expect(stop.order).toBe(1);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, other.token)).status).toBe(404);
    expect((await del(`/api/collections/stops/records/${stop.id}`, other.token)).status).toBe(404);
    const second = await (await createStop(admin.token, id)).json();
    expect(second.order).toBe(2);
    expect((await patch(`/api/collections/stops/records/${second.id}`, { dwell_min: 45 }, crew.token)).status).toBe(200);
    // A stop cannot be moved onto another route, even by its builder.
    const { id: mine2 } = await (await createItinerary(crew.token)).json();
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { itinerary: mine2 }, crew.token)).status).toBe(404);
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await createStop(crew.token, id)).status).toBe(400);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, crew.token)).status).toBe(404);
    expect((await createStop(admin.token, id)).status).toBe(200);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, admin.token)).status).toBe(200);
  });

  it('keeps an explicit zero dwell or order instead of treating it as absent', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const zero = await (await createStop(crew.token, id, { dwell_min: 0, order: 0 })).json();
    expect(zero.dwell_min).toBe(0);
    expect(zero.order).toBe(0);
    const next = await (await createStop(crew.token, id)).json();
    expect(next.dwell_min).toBe(60);
    expect(next.order).toBe(1);
  });

  it('legs and event_log are read-only for users', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    // createRule is null (superuser-only): PocketBase rejects with 403, not the 400 a failed
    // rule expression would give, because there is no rule to evaluate at all.
    expect((await post('/api/collections/legs/records', { itinerary: id, kind: 'walk' }, crew.token)).status).toBe(403);
    expect((await post('/api/collections/event_log/records', { itinerary: id, kind: 'x' }, admin.token)).status).toBe(403);
    expect((await get('/api/collections/legs/records', crew.token)).status).toBe(200);
    // listRule filters rows rather than rejecting the request outright, so an anonymous list
    // still returns 200; assert it excludes a real row that an authenticated caller can see.
    const from = await (await createStop(crew.token, id)).json();
    const to = await (await createStop(crew.token, id)).json();
    const su = await superuserToken();
    const leg = await post('/api/collections/legs/records', { itinerary: id, from_stop: from.id, to_stop: to.id, kind: 'walk' }, su);
    expect(leg.status).toBe(200);
    const anonList = await get('/api/collections/legs/records');
    expect(anonList.status).toBe(200);
    expect((await anonList.json()).totalItems).toBe(0);
    const authedList = await get('/api/collections/legs/records', crew.token);
    expect((await authedList.json()).totalItems).toBeGreaterThanOrEqual(1);
  });
});

describe('votes, comments, approval', () => {
  it('one vote per user per target, only as yourself', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const body = { user: crew.id, target_collection: 'itineraries', target_id: id, value: 'up' };
    expect((await post('/api/collections/votes/records', body, crew.token)).status).toBe(200);
    expect((await post('/api/collections/votes/records', body, crew.token)).status).toBe(400);
    expect((await post('/api/collections/votes/records', { ...body, user: other.id }, crew.token)).status).toBe(400);
    const c = await post('/api/collections/comments/records', { user: crew.id, target_collection: 'itineraries', target_id: id, body: 'Nice' }, crew.token);
    expect(c.status).toBe(200);
    const { id: cid } = await c.json();
    expect((await del(`/api/collections/comments/records/${cid}`, other.token)).status).toBe(404);
    expect((await del(`/api/collections/comments/records/${cid}`, crew.token)).status).toBe(204);
  });

  it('approval votes only while the admin has opened the vote', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const body = { itinerary: id, user: crew.id, value: 'go' };
    expect((await post('/api/collections/approval_votes/records', body, crew.token)).status).toBe(400);
    await patch(`/api/collections/itineraries/records/${id}`, { vote_open: true }, admin.token);
    const first = await post('/api/collections/approval_votes/records', body, crew.token);
    expect(first.status).toBe(200);
    expect((await post('/api/collections/approval_votes/records', body, crew.token)).status).toBe(400);
    const { id: vid } = await first.json();
    expect((await patch(`/api/collections/approval_votes/records/${vid}`, { value: 'nogo' }, crew.token)).status).toBe(200);
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await patch(`/api/collections/approval_votes/records/${vid}`, { value: 'go' }, crew.token)).status).toBe(404);
  });
});

describe('stop_photos', () => {
  it('users may only create user-sourced photos; superuser creates google ones', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const stop = await (await createStop(crew.token, id)).json();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const form = (source: string) => {
      const f = new FormData();
      f.set('stop', stop.id); f.set('source', source); f.set('attribution', 'test');
      f.set('file', new Blob([png], { type: 'image/png' }), 'p.png');
      return f;
    };
    const asUser = await fetch(`${process.env.PB_URL ?? 'http://127.0.0.1:8090'}/api/collections/stop_photos/records`, { method: 'POST', headers: { Authorization: crew.token }, body: form('user') });
    expect(asUser.status).toBe(200);
    const asGoogle = await fetch(`${process.env.PB_URL ?? 'http://127.0.0.1:8090'}/api/collections/stop_photos/records`, { method: 'POST', headers: { Authorization: crew.token }, body: form('google') });
    expect(asGoogle.status).toBe(400);
    const su = await superuserToken();
    const bySu = await fetch(`${process.env.PB_URL ?? 'http://127.0.0.1:8090'}/api/collections/stop_photos/records`, { method: 'POST', headers: { Authorization: su }, body: form('google') });
    expect(bySu.status).toBe(200);
  });
});

const postForm = (path: string, form: FormData, token: string) =>
  fetch(`${PB}${path}`, { method: 'POST', headers: { Authorization: token }, body: form });
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const comment = (token: string, user: string, target_collection: string, target_id: string, body = 'Hi') =>
  post('/api/collections/comments/records', { user, target_collection, target_id, body }, token);

describe('comment and vote targets', () => {
  it('needs text or a file; a photo-only comment is fine', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    expect((await comment(crew.token, crew.id, 'itineraries', id, '')).status).toBe(400);
    expect((await comment(crew.token, crew.id, 'itineraries', id, '   ')).status).toBe(400);
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', id);
    form.set('file', new Blob([GIF], { type: 'image/gif' }), 'pic.gif');
    const res = await postForm('/api/collections/comments/records', form, crew.token);
    expect(res.status).toBe(200);
    expect((await res.json()).file).toMatch(/\.gif$/);
  });

  it('an edit cannot empty a comment', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const text = await (await comment(crew.token, crew.id, 'itineraries', id)).json();
    expect((await patch(`/api/collections/comments/records/${text.id}`, { body: '' }, crew.token)).status).toBe(400);
    expect((await patch(`/api/collections/comments/records/${text.id}`, { body: '  ' }, crew.token)).status).toBe(400);
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', id);
    form.set('file', new Blob([GIF], { type: 'image/gif' }), 'pic.gif');
    const photo = await (await postForm('/api/collections/comments/records', form, crew.token)).json();
    expect((await patch(`/api/collections/comments/records/${photo.id}`, { file: null }, crew.token)).status).toBe(400);
    expect((await patch(`/api/collections/comments/records/${photo.id}`, { 'file-': [photo.file] }, crew.token)).status).toBe(400);
    const kept = await (await get(`/api/collections/comments/records/${photo.id}`, crew.token)).json();
    expect(kept.file).toBe(photo.file);
    expect((await patch(`/api/collections/comments/records/${photo.id}`, { body: 'Caption' }, crew.token)).status).toBe(200);
    expect((await patch(`/api/collections/comments/records/${photo.id}`, { file: null }, crew.token)).status).toBe(200);
  });

  it('rejects a comment or vote whose target does not exist, with or without a file', async () => {
    expect((await comment(crew.token, crew.id, 'itineraries', 'aaaaaaaaaaaaaaa')).status).toBe(400);
    expect((await comment(crew.token, crew.id, 'stops', 'aaaaaaaaaaaaaaa')).status).toBe(400);
    expect((await comment(crew.token, crew.id, 'users', crew.id)).status).toBe(400);
    const vote = { user: crew.id, target_collection: 'itineraries', target_id: 'aaaaaaaaaaaaaaa', value: 'up' };
    expect((await post('/api/collections/votes/records', vote, crew.token)).status).toBe(400);
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', 'aaaaaaaaaaaaaaa');
    form.set('file', new Blob([GIF], { type: 'image/gif' }), 'pic.gif');
    expect((await postForm('/api/collections/comments/records', form, crew.token)).status).toBe(400);
  });

  it('refuses to move a comment or vote to another target', async () => {
    const { id: a } = await (await createItinerary(crew.token)).json();
    const { id: b } = await (await createItinerary(crew.token)).json();
    const c = await (await comment(crew.token, crew.id, 'itineraries', a)).json();
    expect((await patch(`/api/collections/comments/records/${c.id}`, { target_id: b }, crew.token)).status).toBe(404);
    expect((await patch(`/api/collections/comments/records/${c.id}`, { body: 'Edited' }, crew.token)).status).toBe(200);
  });

  it('rejects a non-media attachment even when the client is bypassed', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', id);
    form.set('file', new Blob(['#!/bin/sh'], { type: 'text/plain' }), 'run.sh');
    expect((await postForm('/api/collections/comments/records', form, crew.token)).status).toBe(400);
  });

  it('a route delete that fails keeps its comments and votes (cleanup rolls back)', async () => {
    const su = await superuserToken();
    const { id } = await (await createItinerary(crew.token)).json();
    await comment(crew.token, crew.id, 'itineraries', id);
    await post('/api/collections/votes/records', { user: crew.id, target_collection: 'itineraries', target_id: id, value: 'up' }, crew.token);
    // A throwaway collection with a required, non-cascading relation makes PocketBase refuse the delete.
    const itCol = await (await get('/api/collections/itineraries', su)).json();
    try {
      const hold = await post('/api/collections', { name: 'zz_hold', type: 'base', fields: [
        { name: 'it', type: 'relation', collectionId: itCol.id, maxSelect: 1, required: true, cascadeDelete: false }
      ] }, su);
      expect(hold.status).toBe(200);
      expect((await post('/api/collections/zz_hold/records', { it: id }, su)).status).toBe(200);
      expect((await del(`/api/collections/itineraries/records/${id}`, admin.token)).status).toBe(400);
      const filter = encodeURIComponent(`target_id="${id}"`);
      expect((await (await get(`/api/collections/comments/records?filter=${filter}`, crew.token)).json()).totalItems).toBe(1);
      expect((await (await get(`/api/collections/votes/records?filter=${filter}`, crew.token)).json()).totalItems).toBe(1);
    } finally {
      await del('/api/collections/zz_hold', su);
    }
  });

  it('comments racing a route delete never outlive it', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const writes = Array.from({ length: 12 }, (_, i) => comment(crew.token, crew.id, 'itineraries', id, `race ${i}`));
    const gone = del(`/api/collections/itineraries/records/${id}`, crew.token);
    await Promise.all([...writes, gone]);
    const su = await superuserToken();
    const left = await (await get(`/api/collections/comments/records?filter=${encodeURIComponent(`target_id="${id}"`)}`, su)).json();
    expect(left.totalItems).toBe(0);
  });

  it('deleting a stop removes its comments and votes; deleting a route removes its and its stops\'', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const s1 = await (await createStop(crew.token, id)).json();
    const s2 = await (await createStop(crew.token, id)).json();
    await comment(crew.token, crew.id, 'stops', s1.id);
    await post('/api/collections/votes/records', { user: crew.id, target_collection: 'stops', target_id: s1.id, value: 'up' }, crew.token);
    expect((await del(`/api/collections/stops/records/${s1.id}`, crew.token)).status).toBe(204);
    const count = async (col: string, target: string) =>
      (await (await get(`/api/collections/${col}/records?filter=${encodeURIComponent(`target_id="${target}"`)}`, crew.token)).json()).totalItems;
    expect(await count('comments', s1.id)).toBe(0);
    expect(await count('votes', s1.id)).toBe(0);

    await comment(crew.token, crew.id, 'stops', s2.id);
    await comment(crew.token, crew.id, 'itineraries', id);
    await post('/api/collections/votes/records', { user: crew.id, target_collection: 'itineraries', target_id: id, value: 'up' }, crew.token);
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await del(`/api/collections/itineraries/records/${id}`, admin.token)).status).toBe(204);
    expect(await count('comments', s2.id)).toBe(0);
    expect(await count('comments', id)).toBe(0);
    expect(await count('votes', id)).toBe(0);
  });
});
