import { beforeAll, expect, it } from 'vitest';
import { del, get, patch, post, superuserToken, loginToken } from './setup';
let root = '', user = '', stop = '';
const path = (c: string) => `/api/collections/${c}/records`;
const at = '2026-12-26T18:00:00.000Z';
beforeAll(async () => {
  root = await superuserToken();
  user = (await loginToken('Order Test')).id;
  const itinerary = await (await post(path('itineraries'), { created_by: user, title: 'Order', event_date: '2026-12-26', start_time: '11:00' }, root)).json();
  stop = (await (await post(path('stops'), { itinerary: itinerary.id, name: 'Order', station_id: 'CUS' }, root)).json()).id;
});
const create = async (c: string, extra = {}) => {
  const res = await post(path(c), { user, stop, at, kind: c === 'checkins' ? 'at_stop' : 'beer', ...extra }, root);
  expect(res.status).toBe(200);
  return res.json();
};
it.each(['checkins', 'drink_entries'])('%s orders concurrent paused actions and ignores forged values', async c => {
  const rows = await Promise.all(Array.from({ length: 6 }, () => create(c, { action_order: 999999 })));
  expect(rows.every(r => Number.isSafeInteger(r.action_order) && r.action_order > 0 && r.action_order !== 999999)).toBe(true);
  expect(new Set(rows.map(r => r.action_order)).size).toBe(6);
  const latest = rows.sort((a, b) => b.action_order - a.action_order)[0];
  const changed = await patch(`${path(c)}/${latest.id}`, { action_order: 1 }, root);
  expect(changed.status).toBe(200);
  expect((await changed.json()).action_order).toBe(latest.action_order);
  await del(`${path(c)}/${latest.id}`, root);
  const next = await create(c);
  expect(next.action_order).toBeGreaterThan(latest.action_order);
  expect(Date.parse(next.at)).toBe(Date.parse(at));
});
it('rolls back the counter when record validation fails', async () => {
  const before = await (await get(`${path('action_sequence')}/eventactions001`, root)).json();
  expect((await post(path('drink_entries'), { user, stop, at, kind: 'invalid' }, root)).ok).toBe(false);
  const after = await (await get(`${path('action_sequence')}/eventactions001`, root)).json();
  expect(after.value).toBe(before.value);
  expect(after.value).toBeGreaterThan(0);
});
it('orders repeated paused saves/retries across both action collections', async () => {
  const a = await create('checkins');
  const b = await create('checkins');
  const beer = await create('drink_entries');
  const water = await create('drink_entries', { kind: 'water' });
  expect(a.action_order).toBeLessThan(b.action_order);
  expect(b.action_order).toBeLessThan(beer.action_order);
  expect(beer.action_order).toBeLessThan(water.action_order);
});
