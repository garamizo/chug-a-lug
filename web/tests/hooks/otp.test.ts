import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PB, deleteRecords, deleteUser, post, seedAllowlist, superuserToken } from './setup';

const CODE = process.env.OTP_DEV_CODE ?? '000000';
const wrongCode = CODE === '111111' ? '222222' : '111111';
const phones: string[] = [];
function phone() {
  const value = '+1312' + String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
  phones.push(value);
  return value;
}
const PHONE = phone();
const check = (number: string, pin = '4321', code = CODE) => post('/api/crawl/otp/check', { phone: number, pin, code });
const login = (number: string, pin: string) => post('/api/collections/users/auth-with-password', { identity: number, password: pin });

// These tests require a disposable PocketBase started with --dev and OTP_DEV_CODE.
describe('PocketBase OTP and access rules', () => {
  beforeAll(async () => { await seedAllowlist(PHONE, 'Hook Tester', true); });
  afterAll(async () => {
    for (const number of phones) {
      await deleteUser(number);
      await deleteRecords('allowlist', number);
    }
  });

  it('rejects malformed input and numbers outside the allowlist', async () => {
    for (const invalid of ['12', 'abc3125550142', '+44 20 7946 0958', '+3125550142']) {
      expect((await post('/api/crawl/otp/start', { phone: invalid })).status).toBe(400);
    }
    expect((await post('/api/crawl/otp/start', { phone: phone() })).status).toBe(403);
    expect((await check(PHONE, '12')).status).toBe(400);
    expect((await check(PHONE, 'abcd')).status).toBe(400);
    expect((await check(PHONE, '123456789')).status).toBe(400);
    expect((await check(PHONE, '1234', 'abc')).status).toBe(400);
  });

  it('signs up, logs in, recovers a PIN and revokes the old password', async () => {
    expect((await post('/api/crawl/otp/start', { phone: PHONE })).status).toBe(204);
    expect((await check(PHONE, '4321', wrongCode)).status).toBe(401);
    const signup = await check(PHONE);
    expect(signup.status).toBe(200);
    const body = await signup.json();
    expect(body.token).toBeTypeOf('string');
    expect(body.record).toMatchObject({ phone: PHONE, name: 'Hook Tester', is_admin: true, verified: true });
    expect(body.record.password).toBeUndefined();
    expect((await login(PHONE, '4321')).status).toBe(200);
    expect((await login(PHONE, '0000')).status).toBe(400);
    expect((await check(PHONE, '9876')).status).toBe(200);
    expect((await login(PHONE, '9876')).status).toBe(200);
    expect((await login(PHONE, '4321')).status).toBe(400);
  });

  it('enforces self edits and protects identity, privileges, PINs and allowlist access', async () => {
    const number = phone();
    await seedAllowlist(number, 'Regular User');
    const { token, record } = await (await check(number)).json();
    const resource = `${PB}/api/collections/users/records/${record.id}`;
    const patch = (body: unknown) => fetch(resource, {
      method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    expect((await patch({ name: 'Renamed', share_position: true })).status).toBe(200);
    for (const body of [{ is_admin: true }, { phone: PHONE }, { password: 'abcd', passwordConfirm: 'abcd', oldPassword: '4321' }]) {
      expect((await patch(body)).status).toBe(404);
    }
    expect((await fetch(`${PB}/api/collections/users/records`, { headers: { Authorization: token } })).status).toBe(200);
    expect((await fetch(resource, { headers: { Authorization: token } })).status).toBe(200);
    expect((await fetch(resource)).status).toBe(404);
    expect((await fetch(`${PB}/api/collections/allowlist/records`, { headers: { Authorization: token } })).status).toBe(403);
    expect((await post('/api/collections/users/records', { phone: phone(), password: '1234', passwordConfirm: '1234' }, token)).status).toBe(403);
    expect((await fetch(resource, { method: 'DELETE', headers: { Authorization: token } })).status).toBe(403);
    const admin = await superuserToken();
    const others = await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent(`phone="${PHONE}"`)}`, { headers: { Authorization: admin } }).then(r => r.json());
    expect((await fetch(`${PB}/api/collections/users/records/${others.items[0].id}`, { method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Hijacked' }) })).status).toBe(404);
  });

  it('atomically limits concurrent OTP starts to five per hour', async () => {
    const number = phone();
    await seedAllowlist(number, 'Start Limit');
    const statuses = await Promise.all(Array.from({ length: 8 }, async () => (await post('/api/crawl/otp/start', { phone: number })).status));
    expect(statuses.filter(s => s === 204)).toHaveLength(5);
    expect(statuses.filter(s => s === 429)).toHaveLength(3);
  });

  it('limits OTP guesses and PIN login attempts', async () => {
    const number = phone();
    await seedAllowlist(number, 'Guess Limit');
    expect((await check(number)).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await check(number, '4321', wrongCode)).status).toBe(401);
    expect((await check(number)).status).toBe(429);
    for (let i = 0; i < 10; i++) expect((await login(number, '9999')).status).toBe(400);
    expect((await login(number, '4321')).status).toBe(429);
  });
});
