import { expect, it, vi } from 'vitest';
import { seedTimetable, verifySeedLegs } from '../../src/lib/server/sim/seed';
import { REHEARSAL_CONDUCTOR_EMAIL } from '../../src/lib/sim/config';
import scenario from '../fixtures/sim/timetable/scenario.json';
const clock = { runId: 'test', ...scenario };
it('creates the paused clock before users and stops, remints IDs, then locks by update', async () => {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let n = 0;
  const request = vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/users/records')) return { totalItems: 1, items: [{ id: 'c', email: REHEARSAL_CONDUCTOR_EMAIL }] };
    if (method === 'GET') return { totalItems: 0, items: [] };
    if (path === '/api/crawl/login') return { record: { id: `user${++n}` } };
    return { id: `record${++n}` };
  });
  const result = await seedTimetable(request, clock, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL);
  const writes = calls.filter(c => c.method !== 'GET');
  expect(writes[0]).toMatchObject({ path: '/api/collections/simulation_clock/records', body: {
    id: 'simulationclock', rate: 0, revision: 1, run_id: 'test', source: 'timetable'
  } });
  expect(writes.at(-1)).toMatchObject({ method: 'PATCH', path: `/api/collections/itineraries/records/${result.itineraryId}`, body: { status: 'locked' } });
  const stops = writes.filter(c => c.path.endsWith('/stops/records'));
  expect(stops).toHaveLength(3);
  expect(stops.map(c => c.body?.order)).toEqual([1, 2, 3]);
  expect(stops.every(c => !c.body?.id)).toBe(true);
  expect(writes.some(c => /\/(likes|drink_entries|checkins|broadcasts|media)\//.test(c.path))).toBe(false);
});
it('refuses a populated database before any create or update', async () => {
  const request = vi.fn(async () => ({ totalItems: 1, items: [{ id: 'existing' }] }));
  await expect(seedTimetable(request, clock, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL)).rejects.toThrow();
  expect(request.mock.calls.length).toBe(1);
});
it('requires actual planner legs covering every adjacent stop', () => {
  const ids = ['one', 'two', 'three'];
  const legs = [
    { from_stop: 'one', to_stop: 'two', kind: 'train', depart_at: '2026-12-26T16:40:00Z', arrive_at: '2026-12-26T17:09:00Z' },
    { from_stop: 'two', to_stop: 'three', kind: 'train', depart_at: '2026-12-26T19:10:00Z', arrive_at: '2026-12-26T19:50:00Z' }
  ];
  expect(verifySeedLegs(ids, legs, scenario)).toBe(true);
  expect(verifySeedLegs(ids, legs.slice(0, 1), scenario)).toBe(false);
  expect(verifySeedLegs(ids, [legs[0], legs[0]], scenario)).toBe(false);
  expect(verifySeedLegs(ids, [legs[0], { ...legs[1], kind: 'impossible' }], scenario)).toBe(false);
  expect(verifySeedLegs(ids, [legs[0], { ...legs[1], arrive_at: '2026-12-27T06:00:00Z' }], scenario)).toBe(false);
});

it('seeds the selected recording identity before event-producing writes', async () => {
  const request = vi.fn(async (method: string, path: string) => method === 'GET' ? { totalItems: path.includes('/users/records') ? 1 : 0, items: [{ id: 'c', email: REHEARSAL_CONDUCTOR_EMAIL }] } :
    path === '/api/crawl/login' ? { record: { id: 'user' } } : { id: 'record' });
  await seedTimetable(request, { ...clock, recordingId: 'recording' }, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL);
  expect(request).toHaveBeenCalledWith('POST', '/api/collections/simulation_clock/records', expect.objectContaining({
    source: 'recording', recording_id: 'recording', service_date: '2026-12-26'
  }));
});

it('allows exactly the minted rehearsal Conductor in the users table', async () => {
  const request = vi.fn(async (method: string, path: string) => {
    if (method === 'GET' && path.includes('/users/records')) return { totalItems: 1, items: [{ id: 'c', email: REHEARSAL_CONDUCTOR_EMAIL }] };
    if (method === 'GET') return { totalItems: 0, items: [] };
    if (path === '/api/crawl/login') return { record: { id: 'u' } };
    return { id: 'r' };
  });
  await expect(seedTimetable(request, clock, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL)).resolves.toBeTruthy();
});

it('still refuses any other user', async () => {
  const request = vi.fn(async (method: string, path: string) => {
    if (method === 'GET' && path.includes('/users/records')) return { totalItems: 1, items: [{ id: 'x', email: 'someone@else.invalid' }] };
    return { totalItems: 0, items: [] };
  });
  await expect(seedTimetable(request, clock, scenario, { crew: 'crew', conductor: 'boss' }, REHEARSAL_CONDUCTOR_EMAIL)).rejects.toThrow();
});
