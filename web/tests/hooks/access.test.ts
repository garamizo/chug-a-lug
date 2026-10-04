import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, codeFor, get, loginToken, mails, post, superuserToken } from './setup';

const emailOf = (key: string) => `${Buffer.from(key).toString('hex')}@test.invalid`;
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}

describe('sign-in by email code and the guards', () => {
  beforeEach(clearMails);

  it('a member signs in with an emailed code, and it is logged', async () => {
    const name = `Coder ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    // Case-folding is the client's job (requestCode lowercases); PocketBase sees the stored form.
    const { otpId } = await (await post('/api/collections/users/request-otp', { email })).json();
    const auth = await post('/api/collections/users/auth-with-otp', { otpId, password: await codeFor(email) });
    expect(auth.status).toBe(200);
    expect((await auth.json()).record.id).toBe(id);
    expect((await logRows(`user = "${id}" && event = "signed_in" && method = "email"`)).length).toBe(1);
  });

  it('a non-member asks for a code and nothing is sent', async () => {
    const res = await post('/api/collections/users/request-otp', { email: 'nobody@test.invalid' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mails('nobody@test.invalid')).toEqual([]);
  });

  it('a blocked member cannot sign in or refresh, and a refresh never logs a sign-in', async () => {
    // A real OTP session: impersonation tokens (loginToken) are not refreshable at all.
    const name = `Blocked ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    const otp = async () => {
      await clearMails();
      const { otpId } = await (await post('/api/collections/users/request-otp', { email })).json();
      return post('/api/collections/users/auth-with-otp', { otpId, password: await codeFor(email) });
    };
    const { token } = await (await otp()).json();
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(200);
    expect((await logRows(`user = "${id}" && event = "signed_in"`)).length).toBe(1); // the OTP sign-in only
    // A code mailed before the put-off: once blocked, no new code is ever mailed (below).
    await clearMails();
    const { otpId } = await (await post('/api/collections/users/request-otp', { email })).json();
    const early = await codeFor(email);
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(401); // blocking now ends the session
    // Blocking rotates the token key, and PocketBase then drops the seat's open codes: the code mailed
    // before the put-off is dead too, and no new one is ever mailed (next test). The sign-in guard
    // is proven on password auth below; Google refuses a blocked seat in oauth.test.ts.
    const otps = await (await fetch(`${PB}/api/collections/_otps/records?filter=${encodeURIComponent(`recordRef="${id}"`)}`, { headers: await su() })).json();
    expect(otps.items).toEqual([]);
    expect((await post('/api/collections/users/auth-with-otp', { otpId, password: early })).status).toBe(400);
  });

  it('a put-off member asks for a code: the answer looks like anyone\'s, and no mail is sent', async () => {
    const name = `Unmailed ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    const res = await post('/api/collections/users/request-otp', { email });
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).otpId).toBe('string');
    await new Promise((r) => setTimeout(r, 700));
    expect(await mails(email)).toEqual([]);
    expect((await logRows(`user = "${id}" && event = "code_sent"`)).length).toBe(0);
  });

  it('every sign-in method is guarded, even one switched on later (password auth)', async () => {
    const name = `Passworded ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    const collection = async (enabled: boolean) => fetch(`${PB}/api/collections/users`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ passwordAuth: { enabled } }) });
    const before = (await (await fetch(`${PB}/api/collections/users`, { headers: await su() })).json()).passwordAuth.enabled as boolean;
    try {
      expect((await collection(true)).status).toBe(200);
      await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(),
        body: JSON.stringify({ password: 'recovery-password-1', passwordConfirm: 'recovery-password-1', blocked: true }) });
      expect((await post('/api/collections/users/auth-with-password', { identity: email, password: 'recovery-password-1' })).status).toBe(403);
      expect((await logRows(`user = "${id}" && event = "sign_in_refused" && method = ""`)).length).toBe(1);
    } finally {
      expect((await collection(before)).status).toBe(200);
    }
  });

  it('crew cannot change their own email through PocketBase\'s email-change flow', async () => {
    const { token } = await loginToken(`Mover ${Math.floor(Math.random() * 1e6)}`);
    const newEmail = `moved${Math.floor(Math.random() * 1e6)}@test.invalid`;
    const res = await post('/api/collections/users/request-email-change', { newEmail }, token);
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('Ask the Conductor to change your email.');
    await new Promise((r) => setTimeout(r, 500));
    expect(await mails(newEmail)).toEqual([]);
  });

  it('a put-off that lands while the person saves their own record is never undone', async () => {
    const boss = await loginToken(`Guard ${Math.floor(Math.random() * 1e6)}`, ADMIN_LOGIN_PASSWORD);
    for (let round = 0; round < 3; round++) {
      const rider = await loginToken(`Racer ${Math.floor(Math.random() * 1e6)}`);
      const save = (i: number) => fetch(`${PB}/api/collections/users/records/${rider.id}`, { method: 'PATCH',
        headers: { Authorization: rider.token, 'content-type': 'application/json' }, body: JSON.stringify({ share_position: i % 2 === 0 }) });
      const early = Array.from({ length: 12 }, (_, i) => save(i));
      const off = post(`/api/crawl/users/${rider.id}/put-off`, {}, boss.token);
      const late = Array.from({ length: 12 }, (_, i) => save(i));
      expect((await off).status).toBe(200);
      await Promise.all([...early, ...late]);
      const row = await (await fetch(`${PB}/api/collections/users/records/${rider.id}`, { headers: await su() })).json();
      expect(row.blocked, `round ${round}`).toBe(true);
      expect((await get('/api/crawl/me', rider.token)).status, `round ${round}`).toBe(401);
      expect((await post('/api/collections/users/auth-refresh', {}, rider.token)).status, `round ${round}`).toBe(401);
    }
  });

  it('the Conductor exists from CONDUCTOR_EMAIL with is_admin', async () => {
    const q = new URLSearchParams({ filter: 'email = "conductor@test.invalid"' });
    const rows = (await (await fetch(`${PB}/api/collections/users/records?${q}`, { headers: await su() })).json()).items;
    expect(rows).toHaveLength(1);
    expect(rows[0].is_admin).toBe(true);
  });

  it('users cannot change their own privileges, email or bookkeeping', async () => {
    const { id, token } = await loginToken(`Self ${Math.floor(Math.random() * 1e6)}`);
    for (const body of [{ is_admin: true }, { blocked: true }, { email: 'x@test.invalid' }, { approved_by: id }, { last_seen: '2020-01-01 00:00:00.000Z' }, { name_key: 'x' }]) {
      const res = await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
  });
});
