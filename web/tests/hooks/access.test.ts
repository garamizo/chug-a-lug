import { beforeEach, describe, expect, it } from 'vitest';
import { PB, clearMails, codeFor, loginToken, mails, post, superuserToken } from './setup';

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
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(401); // blocking now ends the session
    expect((await otp()).status).toBe(403);
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
