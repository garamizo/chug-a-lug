// The users collection's access rules for a member. Privilege-field denials live in Task 4's tests.
import { afterAll, expect, it } from 'vitest';
import { PB, deleteUserByName, loginToken, post } from './setup';

const names: string[] = [];
const name = (prefix: string) => { const v = `${prefix} ${Math.floor(Math.random() * 1e6)}`; names.push(v); return v; };
afterAll(async () => { for (const n of names) await deleteUserByName(n); });

it('lets a member edit their own preferences, and nothing else of the collection', async () => {
  const n = name('Rider');
  const { token, id } = await loginToken(n);
  const other = await loginToken(name('Other'));
  const resource = `${PB}/api/collections/users/records/${id}`;
  const patch = (url: string, body: unknown) => fetch(url, {
    method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  expect((await patch(resource, { share_position: true, home_station: 'Elburn', left_early: true })).status).toBe(200);
  expect((await patch(`${PB}/api/collections/users/records/${other.id}`, { left_early: true })).status).toBe(404);
  expect((await fetch(`${PB}/api/collections/users/records`, { headers: { Authorization: token } })).status).toBe(200);
  expect((await fetch(resource)).status).toBe(404);
  expect((await post('/api/collections/users/records', { name: 'Sneaky', name_key: 'sneaky', email: 'sneaky@test.invalid',
    password: 'abcdefgh', passwordConfirm: 'abcdefgh' }, token)).status).toBe(403);
  expect((await fetch(resource, { method: 'DELETE', headers: { Authorization: token } })).status).toBe(403);
  // Password auth is on (password spec): only the right password signs in.
  const identity = `${Buffer.from(n.toLowerCase()).toString('hex')}@test.invalid`;
  expect((await post('/api/collections/users/auth-with-password', { identity, password: 'wrong-password-1' })).status).toBe(400);
  expect((await post('/api/collections/users/auth-with-password', { identity, password: 'seed-test-password-1' })).status).toBe(200);
});
