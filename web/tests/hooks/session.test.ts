import { expect, it } from 'vitest';
import { get, loginToken, setRole } from './setup';

it('names the caller without minting a token, and refuses put-off or missing sessions', async () => {
  const { token, id } = await loginToken(`Me ${Math.floor(Math.random() * 1e6)}`);
  const me = await get('/api/crawl/me', token);
  expect(me.status).toBe(200);
  const body = await me.json();
  expect(body.record.id).toBe(id);
  expect(body.token).toBeUndefined();
  // The owner sees their own address (the email is hidden from everyone else).
  expect(body.record.email).toBe(`${Buffer.from(body.record.name_key).toString('hex')}@test.invalid`);
  expect((await get('/api/crawl/me')).status).toBe(401);
  expect((await get('/api/crawl/me', 'nonsense')).status).toBe(401);
  await setRole(id, 'put_off');
  expect((await get('/api/crawl/me', token)).status).toBe(401); // putting off ends the session
});
