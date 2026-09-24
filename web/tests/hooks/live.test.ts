// The live collections' rules against a live PocketBase: Bulletins are the Conductor's alone, acks
// and drinks belong to whoever wrote them, and everyone can read all of it.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, del, get, loginToken, patch, post, truncate, PB } from './setup';

let conductor = '', crew = '', conductorId = '', crewId = '', itineraryId = '', stopId = '';

beforeAll(async () => {
  for (const c of ['broadcast_acks', 'broadcasts', 'drink_entries', 'media']) await truncate(c);
  ({ token: conductor, id: conductorId } = await loginToken('Live Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew, id: crewId } = await loginToken('Live Crew'));

  const itin = await (await post('/api/collections/itineraries/records', {
    title: 'Live rules', status: 'locked', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
  }, conductor)).json();
  itineraryId = itin.id;
  // Every itinerary is created as a draft (pb_hooks/planning.pb.js), regardless of what the
  // create body asked for; locking one is an update.
  await patch(`/api/collections/itineraries/records/${itineraryId}`, { status: 'locked' }, conductor);
  stopId = (await (await post('/api/collections/stops/records', {
    itinerary: itineraryId, order: 1, name: 'The Hop Haus', station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5
  }, conductor)).json()).id;
});

describe('broadcasts', () => {
  it('lets the Conductor post a Bulletin', async () => {
    const res = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'message', body: 'Meet under the clock.', created_by: conductorId
    }, conductor);
    expect(res.status).toBe(200);
  });

  it('refuses a Bulletin from the Crew', async () => {
    const res = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'message', body: 'Free round on the Conductor.', created_by: crewId
    }, crew);
    expect(res.status).toBe(400);
  });

  it('lets the Crew read Bulletins', async () => {
    const res = await get('/api/collections/broadcasts/records', crew);
    expect(res.status).toBe(200);
    expect((await res.json()).totalItems).toBeGreaterThan(0);
  });
});

describe('broadcast_acks', () => {
  let broadcastId = '';
  beforeAll(async () => {
    broadcastId = (await (await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'hold', body: 'Holding here.', created_by: conductorId
    }, conductor)).json()).id;
  });

  it('records an ack once', async () => {
    const first = await post('/api/collections/broadcast_acks/records', { broadcast: broadcastId, user: crewId }, crew);
    expect(first.status).toBe(200);
    const again = await post('/api/collections/broadcast_acks/records', { broadcast: broadcastId, user: crewId }, crew);
    expect(again.status).toBe(400); // the unique index, not a hook
  });

  it('refuses an ack on someone else’s behalf', async () => {
    const res = await post('/api/collections/broadcast_acks/records', { broadcast: broadcastId, user: conductorId }, crew);
    expect(res.status).toBe(400);
  });
});

describe('drink_entries', () => {
  it('logs and removes your own drink', async () => {
    const created = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2026-12-26T20:00:00.000Z'
    }, crew);
    expect(created.status).toBe(200);
    const id = (await created.json()).id;
    expect((await del(`/api/collections/drink_entries/records/${id}`, conductor)).status).toBe(404);
    expect((await del(`/api/collections/drink_entries/records/${id}`, crew)).status).toBe(204);
  });

  it('refuses a drink logged for someone else', async () => {
    const res = await post('/api/collections/drink_entries/records', {
      user: conductorId, stop: stopId, kind: 'shot', at: '2026-12-26T20:05:00.000Z'
    }, crew);
    expect(res.status).toBe(400);
  });

  it('stamps a drink with server time, whatever time the phone sent', async () => {
    const before = Date.now();
    const res = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2020-01-01T00:00:00.000Z'
    }, crew);
    expect(res.status).toBe(200);
    const at = Date.parse((await res.json()).at);
    expect(at).toBeGreaterThanOrEqual(before - 5000);
    expect(at).toBeLessThanOrEqual(Date.now() + 5000);
  });
});

describe('anonymous access', () => {
  it('refuses an anonymous create on broadcasts, broadcast_acks, drink_entries and media', async () => {
    const broadcast = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'message', body: 'Nobody is signed in.', created_by: conductorId
    });
    expect(broadcast.status).toBe(400);

    const ack = await post('/api/collections/broadcast_acks/records', { broadcast: itineraryId, user: crewId });
    expect(ack.status).toBe(400);

    const drink = await post('/api/collections/drink_entries/records', {
      user: crewId, stop: stopId, kind: 'beer', at: '2026-12-26T20:00:00.000Z'
    });
    expect(drink.status).toBe(400);

    const form = new FormData();
    form.set('user', crewId);
    form.set('kind', 'image');
    form.set('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'shot.jpg');
    const media = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', body: form });
    expect(media.status).toBe(400);
  });

  it('shows an anonymous reader nothing on broadcasts', async () => {
    // PocketBase list rules filter rather than reject, so the giveaway is an empty page, not a 403.
    const res = await get('/api/collections/broadcasts/records');
    expect(res.status).toBe(200);
    expect((await res.json()).totalItems).toBe(0);
  });
});

describe('media tagging', () => {
  const upload = async (token: string, userId: string, stop: string | null) => {
    const form = new FormData();
    form.set('user', userId);
    form.set('kind', 'image');
    form.set('taken_at', '2026-12-26T20:00:00.000Z');
    if (stop !== null) form.set('stop', stop);
    form.set('file', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'shot.jpg');
    const res = await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: token }, body: form });
    return { status: res.status, body: await res.json() };
  };

  it('tags an upload at a stop of the locked route with the clock', async () => {
    const { status, body } = await upload(crew, crewId, stopId);
    expect(status).toBe(200);
    expect(body).toMatchObject({ stop: stopId, tagged_by: 'clock' });
  });

  it('clears a stop that belongs to no locked route rather than rejecting the photo', async () => {
    const draft = await (await post('/api/collections/itineraries/records', {
      title: 'Not the route', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
    }, conductor)).json();
    const strayStop = (await (await post('/api/collections/stops/records', {
      itinerary: draft.id, order: 1, name: 'Elsewhere', station_id: 'CUS', dwell_min: 60, walk_min: 5
    }, conductor)).json()).id;

    const { status, body } = await upload(crew, crewId, strayStop);
    expect(status).toBe(200);
    expect(body).toMatchObject({ stop: '', tagged_by: 'none' });
  });

  it('accepts a photo with no stop at all', async () => {
    const { status, body } = await upload(crew, crewId, null);
    expect(status).toBe(200);
    expect(body).toMatchObject({ stop: '', tagged_by: 'none' });
  });
});

describe('bulletin bookkeeping', () => {
  it('stamps the author and writes the Train Sheet entry', async () => {
    const res = await post('/api/collections/broadcasts/records', {
      itinerary: itineraryId, kind: 'annul', body: 'LaGrange is annulled.', created_by: crewId
    }, conductor);
    expect(res.status).toBe(200);
    expect((await res.json()).created_by).toBe(conductorId); // the body said crew; the hook overrules it

    const log = await get(`/api/collections/event_log/records?filter=${encodeURIComponent(`itinerary="${itineraryId}" && kind="bulletin"`)}`, conductor);
    expect((await log.json()).totalItems).toBeGreaterThan(0);
  });
});
