// The live collections' rules against a live PocketBase: Bulletins are the Conductor's alone, acks
// and drinks belong to whoever wrote them, and everyone can read all of it.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, del, get, loginToken, post, truncate } from './setup';

let conductor = '', crew = '', conductorId = '', crewId = '', itineraryId = '', stopId = '';

beforeAll(async () => {
  for (const c of ['broadcast_acks', 'broadcasts', 'drink_entries', 'media']) await truncate(c);
  ({ token: conductor, id: conductorId } = await loginToken('Live Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew, id: crewId } = await loginToken('Live Crew'));

  const itin = await (await post('/api/collections/itineraries/records', {
    title: 'Live rules', status: 'locked', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
  }, conductor)).json();
  itineraryId = itin.id;
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
});
