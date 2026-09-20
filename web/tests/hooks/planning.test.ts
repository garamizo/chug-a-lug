import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, del, get, loginToken, patch, post, superuserToken, truncate } from './setup';

let crew: { token: string; id: string };
let other: { token: string; id: string };
let admin: { token: string; id: string };

const createItinerary = (token: string, body: Record<string, unknown> = {}) =>
  post('/api/collections/itineraries/records', { title: 'Test draft', ...body }, token);

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
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Renamed' }, crew.token)).status).toBe(200);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { vote_open: true }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Nope' }, other.token)).status).toBe(404);
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
    const { id } = await (await createItinerary(crew.token, { title: 'Frozen' })).json();
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_time: '12:00' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Renamed' }, crew.token)).status).toBe(403);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { event_date: '2026-12-27' }, crew.token)).status).toBe(403);
    // A no-op write of the same values is not an edit, so it still goes through.
    expect((await patch(`/api/collections/itineraries/records/${id}`, { title: 'Frozen' }, crew.token)).status).toBe(200);
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_time: '12:00' }, admin.token)).status).toBe(200);
    const back = await patch(`/api/collections/itineraries/records/${id}`, { status: 'draft' }, admin.token);
    expect(back.status).toBe(200);
    expect((await back.json()).locked_at).toBe('');
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_time: '12:30' }, crew.token)).status).toBe(200);
  });

  it('owner can delete a draft but not a locked itinerary', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await del(`/api/collections/itineraries/records/${id}`, crew.token)).status).toBe(404);
    const { id: draft } = await (await createItinerary(crew.token)).json();
    expect((await del(`/api/collections/itineraries/records/${draft}`, crew.token)).status).toBe(204);
  });
});

describe('stops', () => {
  it('anyone can add a stop to a draft with defaults; nobody but admin once locked', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const res = await createStop(other.token, id);
    expect(res.status).toBe(200);
    const stop = await res.json();
    expect(stop.dwell_min).toBe(60);
    expect(stop.kind).toBe('bar');
    expect(stop.photos_status).toBe('none');
    expect(stop.order).toBe(1);
    const second = await (await createStop(other.token, id)).json();
    expect(second.order).toBe(2);
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await createStop(other.token, id)).status).toBe(400);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, other.token)).status).toBe(404);
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
