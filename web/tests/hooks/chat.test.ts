// Crew chat: anyone may talk, nobody may talk as someone else, and a Cheers counts once.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, del, loginToken, patch, post, superuserToken, truncate } from './setup';

let conductor = '', crew = '', conductorId = '', crewId = '', itineraryId = '', stopId = '';
const path = (c: string) => `/api/collections/${c}/records`;

beforeAll(async () => {
  for (const c of ['reactions', 'chat_messages']) await truncate(c);
  ({ token: conductor, id: conductorId } = await loginToken('Chat Rules Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew, id: crewId } = await loginToken('Chat Rules Crew'));
  itineraryId = (await (await post(path('itineraries'), {
    title: 'Chat rules', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
  }, conductor)).json()).id;
  await patch(`${path('itineraries')}/${itineraryId}`, { status: 'locked' }, conductor);
  stopId = (await (await post(path('stops'), {
    itinerary: itineraryId, order: 1, name: 'Chat Tap', station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5
  }, conductor)).json()).id;
});

describe('chat_messages', () => {
  it('lets the Crew post, stamped with the server clock whatever the body says', async () => {
    const before = Date.now();
    const res = await post(path('chat_messages'), { itinerary: itineraryId, user: crewId, body: 'Round on me', at: '2000-01-01T00:00:00Z' }, crew);
    expect(res.status).toBe(200);
    expect(Math.abs(Date.parse((await res.json()).at) - before)).toBeLessThan(10_000);
  });

  it('keeps a superuser-supplied time, so a fixture can backdate a line', async () => {
    const res = await post(path('chat_messages'), { itinerary: itineraryId, user: crewId, body: 'From yesterday', at: '2026-09-01T12:00:00Z' }, await superuserToken());
    expect(res.status).toBe(200);
    expect((await res.json()).at).toBe('2026-09-01 12:00:00.000Z');
  });

  it('still stamps a superuser line that gives no time', async () => {
    const before = Date.now();
    const res = await post(path('chat_messages'), { itinerary: itineraryId, user: crewId, body: 'Now' }, await superuserToken());
    expect(res.status).toBe(200);
    expect(Math.abs(Date.parse((await res.json()).at) - before)).toBeLessThan(10_000);
  });

  it('refuses a message posted as someone else', async () => {
    const res = await post(path('chat_messages'), { itinerary: itineraryId, user: conductorId, body: 'Not me' }, crew);
    expect(res.status).toBe(400);
  });

  it('refuses a message over 280 characters', async () => {
    const res = await post(path('chat_messages'), { itinerary: itineraryId, user: crewId, body: 'x'.repeat(281) }, crew);
    expect(res.status).toBe(400);
  });

  it('lets only the author delete a message', async () => {
    const id = (await (await post(path('chat_messages'), { itinerary: itineraryId, user: crewId, body: 'Oops' }, crew)).json()).id;
    expect((await del(`${path('chat_messages')}/${id}`, conductor)).status).toBe(404);
    expect((await del(`${path('chat_messages')}/${id}`, crew)).status).toBe(204);
  });
});

describe('reactions', () => {
  it('counts one Cheers per person per entry', async () => {
    const body = { user: crewId, target_kind: 'message', target_id: 'abcdefghijklmno', itinerary: itineraryId };
    const first = await post(path('reactions'), body, crew);
    expect(first.status).toBe(200);
    expect((await post(path('reactions'), body, crew)).status).toBe(400); // the unique index
    const id = (await first.json()).id;
    expect((await del(`${path('reactions')}/${id}`, conductor)).status).toBe(404);
    expect((await del(`${path('reactions')}/${id}`, crew)).status).toBe(204);
  });

  it('refuses a Cheers on someone else’s behalf', async () => {
    const res = await post(path('reactions'), { user: conductorId, target_kind: 'drink', target_id: 'abcdefghijklmno', itinerary: itineraryId }, crew);
    expect(res.status).toBe(400);
  });
});

describe('media event time', () => {
  it('stamps Freight with the server clock alongside the wall-clock capture time', async () => {
    const form = new FormData();
    form.set('user', crewId); form.set('stop', stopId); form.set('kind', 'image');
    form.set('taken_at', '2026-01-01T00:00:00Z');
    form.set('file', new Blob([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')], { type: 'image/gif' }), 'a.gif');
    const before = Date.now();
    const res = await fetch(`${PB}${path('media')}`, { method: 'POST', headers: { Authorization: crew }, body: form });
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(Math.abs(Date.parse(row.at) - before)).toBeLessThan(10_000);
    expect(row.taken_at.startsWith('2026-01-01')).toBe(true);
  });
});
