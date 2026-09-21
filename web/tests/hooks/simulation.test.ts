import { afterAll, beforeAll, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, del, get, loginToken, patch, post, superuserToken } from './setup';

const path = '/api/collections/simulation_clock/records';
let root = '', crew = '', conductor = '';
const clock = {
  id: 'simulationclock', run_id: 'hook-fixture', revision: 1,
  epoch_start: '2026-12-26T18:00:00Z', wall_start: '2026-09-21T12:00:00Z',
  rate: 0, resume_rate: 1, service_date: '2026-12-26', source: 'timetable',
  window_start: '2026-12-26T06:00:00Z', window_end: '2026-12-27T04:00:00Z'
};
beforeAll(async () => {
  root = await superuserToken();
  ({ token: crew } = await loginToken('Clock Crew'));
  ({ token: conductor } = await loginToken('Clock Conductor', ADMIN_LOGIN_PASSWORD));
});
afterAll(async () => { if (root) await del(`${path}/simulationclock`, root); });
it('installs a private, empty collection without activating a rehearsal', async () => {
  const list = await get(path, root);
  expect(list.status).toBe(200);
  expect((await list.json()).totalItems).toBe(0);
});
it('persists the fixed singleton only through superuser access', async () => {
  const created = await post(path, clock, root);
  expect(created.status).toBe(200);
  const res = await get(`${path}/simulationclock`, root);
  expect(await res.json()).toMatchObject({ run_id: 'hook-fixture', rate: 0, revision: 1 });
  expect((await post(path, { ...clock, id: 'anotherclock001' }, root)).ok).toBe(false);
});
it.each(['crew', 'conductor', 'anonymous'])('locks direct clock access for %s', async (role) => {
  const token = role === 'crew' ? crew : role === 'conductor' ? conductor : undefined;
  const list = await get(path, token);
  // A private null rule may reject; a filtering list rule must never return the record either.
  if (list.ok) expect((await list.json()).items).toEqual([]);
  expect((await get(`${path}/simulationclock`, token)).ok).toBe(false);
  expect((await post(path, clock, token)).ok).toBe(false);
  expect((await patch(`${path}/simulationclock`, { rate: 60 }, token)).ok).toBe(false);
  expect((await del(`${path}/simulationclock`, token)).ok).toBe(false);
});
