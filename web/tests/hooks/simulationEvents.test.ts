import { beforeAll, describe, expect, it } from 'vitest';
import { get, patch, post, superuserToken, loginToken, ADMIN_LOGIN_PASSWORD } from './setup';
const path = (c: string) => `/api/collections/${c}/records`;
const epoch = '2026-12-26T18:00:00.000Z';
let root = '', conductor = '', user = '', itinerary = '';
describe.skipIf(process.env.SIM !== '1')('simulation event hooks', () => {
  beforeAll(async () => {
    root = await superuserToken();
    ({ token: conductor, id: user } = await loginToken('Sim Conductor', ADMIN_LOGIN_PASSWORD));
    itinerary = (await (await post(path('itineraries'), { title: 'Sim', created_by: user }, root)).json()).id;
  });
  it('fails visibly if simulation has no clock', async () => {
    expect((await post(path('broadcasts'), { itinerary, kind: 'message', body: 'Missing', created_by: user }, root)).ok).toBe(false);
  });
  it('stamps Crew and superuser Bulletins/logs with virtual time, keeping wall metadata', async () => {
    const clock = await post(path('simulation_clock'), { id: 'simulationclock', run_id: 'hook-fixture', revision: 1,
      epoch_start: epoch, wall_start: new Date().toISOString(), rate: 0, resume_rate: 1,
      service_date: '2026-12-26', source: 'timetable', window_start: '2026-12-26T06:00:00Z', window_end: '2026-12-27T04:00:00Z' }, root);
    expect(clock.status).toBe(200);
    for (const token of [conductor, root]) {
      const res = await post(path('broadcasts'), { itinerary, kind: 'message', body: 'Paused', created_by: user, at: '2000-01-01T00:00:00Z' }, token);
      expect(res.status).toBe(200);
      const row = await res.json();
      expect(Date.parse(row.at)).toBe(Date.parse(epoch));
      expect(Math.abs(Date.now() - Date.parse(row.created))).toBeLessThan(10000);
      const logs = await (await get(`${path('event_log')}?filter=${encodeURIComponent(`kind='bulletin' && payload.broadcast='${row.id}'`)}`, root)).json();
      expect(logs.items).toHaveLength(1);
      expect(Date.parse(logs.items[0].at)).toBe(Date.parse(epoch));
    }
  });
  it('keeps locked_at real and uses event time for the lock log', async () => {
    const res = await patch(`${path('itineraries')}/${itinerary}`, { status: 'locked' }, root);
    expect(res.status).toBe(200);
    expect(Math.abs(Date.now() - Date.parse((await res.json()).locked_at))).toBeLessThan(10000);
    const logs = await (await get(`${path('event_log')}?filter=${encodeURIComponent(`kind='locked' && itinerary='${itinerary}'`)}`, root)).json();
    expect(Date.parse(logs.items[0].at)).toBe(Date.parse(epoch));
  });
});
