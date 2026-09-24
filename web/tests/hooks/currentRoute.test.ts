import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, get, loginToken, patch, post, superuserToken, PB } from './setup';

let conductor = '', crew = '', conductorId = '', crewId = '';
const route = async (title: string, date: string) => {
  const it = await (await post('/api/collections/itineraries/records', { title, event_date: date, start_time: '11:00', created_by: conductorId }, conductor)).json();
  await patch(`/api/collections/itineraries/records/${it.id}`, { status: 'locked' }, conductor);
  const stop = await (await post('/api/collections/stops/records', { itinerary: it.id, order: 1, name: `${title} bar`, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 }, conductor)).json();
  return { id: it.id as string, stopId: stop.id as string };
};

beforeAll(async () => {
  ({ token: conductor, id: conductorId } = await loginToken('Current Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew, id: crewId } = await loginToken('Current Crew'));
});

describe('crawl_settings', () => {
  it('lets anyone signed in read it and only the Conductor change it', async () => {
    const a = await route('Settings A', '2026-10-03');
    expect((await get('/api/collections/crawl_settings/records/crawlsettings', crew)).status).toBe(200);
    expect((await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: a.id }, crew)).status).toBe(404);
    expect((await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: a.id }, conductor)).status).toBe(200);
  });
  it('hides it from strangers', async () => {
    const res = await get('/api/collections/crawl_settings/records');
    expect((await res.json()).items ?? []).toHaveLength(0);
  });
});

describe('media tagging follows the current route', () => {
  it('tags a photo to a current-route stop and blanks a stop from another locked route', async () => {
    const current = await route('Media current', '2026-10-10');
    const other = await route('Media other', '2026-10-17');
    await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: current.id }, conductor);
    const upload = async (stop: string) => {
      const form = new FormData();
      form.set('user', crewId); form.set('stop', stop); form.set('kind', 'image');
      form.set('file', new Blob([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))], { type: 'image/gif' }), 'x.gif');
      return (await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: crew }, body: form })).json();
    };
    expect((await upload(current.stopId)).stop).toBe(current.stopId);
    expect((await upload(other.stopId)).stop).toBe('');
  });
  it('falls back to the newest locked route when the setting points at an archived one', async () => {
    const stale = await route('Stale', '2026-10-24');
    await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: stale.id }, conductor);
    await patch(`/api/collections/itineraries/records/${stale.id}`, { status: 'archived' }, await superuserToken());
    const newest = await route('Newest', '2026-10-31');
    // A photo for the newest locked route is kept, because the stale setting no longer counts.
    const form = new FormData();
    form.set('user', crewId); form.set('stop', newest.stopId); form.set('kind', 'image');
    form.set('file', new Blob([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))], { type: 'image/gif' }), 'x.gif');
    const row = await (await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: crew }, body: form })).json();
    expect(row.stop).toBe(newest.stopId);
  });
});
