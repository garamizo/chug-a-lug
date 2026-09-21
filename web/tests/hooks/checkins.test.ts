// The checkins rules against a live PocketBase: anyone signed in may read, you may only create
// your own. M3 uses check-ins only for the Conductor's anchor through the plan commit endpoint.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, get, loginToken, post, truncate } from './setup';

let conductor = '';
let crew = '';
let conductorId = '';
let stopId = '';

beforeAll(async () => {
  await truncate('checkins');
  ({ token: conductor, id: conductorId } = await loginToken('Checkin Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew } = await loginToken('Checkin Crew'));

  const itinRes = await post('/api/collections/itineraries/records', {
    title: 'Checkin test', status: 'locked', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
  }, conductor);
  expect(itinRes.ok).toBe(true);
  const itinerary = await itinRes.json();

  const stopRes = await post('/api/collections/stops/records', {
    itinerary: itinerary.id, order: 1, name: 'The Whistle Stop', station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5
  }, conductor);
  expect(stopRes.ok).toBe(true);
  stopId = (await stopRes.json()).id;
});

describe('checkins', () => {
  it('lets a user create their own check-in', async () => {
    const res = await post('/api/collections/checkins/records', {
      user: conductorId, stop: stopId, kind: 'at_stop', at: '2026-12-26 20:00:00.000Z'
    }, conductor);
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe('at_stop');
  });

  it('refuses a check-in created on behalf of someone else', async () => {
    const res = await post('/api/collections/checkins/records', {
      user: conductorId, stop: stopId, kind: 'at_stop', at: '2026-12-26 20:05:00.000Z'
    }, crew);
    expect(res.status).toBe(400);
  });

  it('lets any authenticated user read check-ins', async () => {
    const res = await get('/api/collections/checkins/records?sort=-at', crew);
    expect(res.status).toBe(200);
    expect((await res.json()).items.length).toBeGreaterThan(0);
  });

  it('shows an anonymous reader nothing', async () => {
    // PocketBase list rules filter rather than reject, so the giveaway is an empty page, not a 403.
    const res = await get('/api/collections/checkins/records');
    expect(res.status).toBe(200);
    expect((await res.json()).totalItems).toBe(0);
  });

  it('refuses an anonymous create', async () => {
    const res = await post('/api/collections/checkins/records', {
      user: conductorId, stop: stopId, kind: 'at_stop', at: '2026-12-26 20:10:00.000Z'
    });
    expect(res.status).toBe(400);
  });
});
