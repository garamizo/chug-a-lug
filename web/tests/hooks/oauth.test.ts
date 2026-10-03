import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PB, clearMails, loginToken, mails, oidcCode, post, postFrom, randomIp, superuserToken, truncate } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
const hexEmail = (name: string) => `${Buffer.from(name.toLowerCase()).toString('hex')}@test.invalid`;
const oauth = (code: string, extra: Record<string, unknown> = {}, token?: string) => post('/api/collections/users/auth-with-oauth2',
  { provider: 'oidc', code, codeVerifier: 'v'.repeat(43), redirectURL: 'http://127.0.0.1:15173/auth/google', ...extra }, token);
async function count(collection: string, filter: string) {
  const q = new URLSearchParams({ filter, perPage: '1' });
  return (await (await fetch(`${PB}/api/collections/${collection}/records?${q}`, { headers: await su() })).json()).totalItems as number;
}

describe('the OAuth2 hook (spec §2.5), at runtime', () => {
  beforeAll(async () => {
    const res = await fetch(`${PB}/api/collections/users`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ oauth2: { enabled: true, providers: [{
      name: 'oidc', clientId: 'fake', clientSecret: 'fake', displayName: 'Fake', authURL: 'http://127.0.0.1:12528/auth',
      tokenURL: 'http://127.0.0.1:12528/token', userInfoURL: 'http://127.0.0.1:12528/userinfo' }] } }) });
    expect(res.status).toBe(200);
  });
  afterAll(async () => {
    await fetch(`${PB}/api/collections/users`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ oauth2: { enabled: false, providers: [] } }) });
  });
  beforeEach(() => truncate('boarding_requests'));

  it('a new identity from the join page becomes a waiting request: no user, no link', async () => {
    const email = `g${uid()}@test.invalid`, sub = `s${uid()}`;
    const res = await oauth(oidcCode({ sub, email }), { createData: { name: `Googler ${uid()}` } });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ pending: true });
    expect(await count('users', `email = "${email}"`)).toBe(0);
    expect(await count('_externalAuths', `providerId = "${sub}"`)).toBe(0);
    expect(await count('boarding_requests', `email = "${email}" && status = "waiting" && method = "google"`)).toBe(1);
  });

  it('a Google sign-up for an email already waiting gets a decoy and the waiting notice', async () => {
    const email = `gw${uid()}@test.invalid`;
    const google = (name: string) => postFrom(randomIp(), '/api/collections/users/auth-with-oauth2', { provider: 'oidc', code: oidcCode({ sub: `s${uid()}`, email }),
      codeVerifier: 'v'.repeat(43), redirectURL: 'http://127.0.0.1:15173/auth/google', createData: { name } });
    const first = await google(`Google Waiter ${uid()}`);
    expect(first.status).toBe(202);
    await clearMails();
    const again = await google(`Google Again ${uid()}`);
    expect(again.status).toBe(202);
    expect(Object.keys(await again.json()).sort()).toEqual(Object.keys(await first.json()).sort());
    expect(await count('boarding_requests', `email = "${email}" && status = "waiting"`)).toBe(1);
    expect(await count('users', `email = "${email}"`)).toBe(0);
    expect((await mails(email)).at(-1)?.text).toContain('already waiting');
  });

  it('a new identity from the login page is refused', async () => {
    const res = await oauth(oidcCode({ sub: `s${uid()}`, email: `nobody${uid()}@test.invalid` }));
    expect(res.status).toBe(403);
  });

  it('a member signs in with the matching email', async () => {
    const name = `Linked ${uid()}`;
    const { id } = await loginToken(name);
    const res = await oauth(oidcCode({ sub: `s${uid()}`, email: hexEmail(name) }));
    expect(res.status).toBe(200);
    expect((await res.json()).record.id).toBe(id);
  });

  it('a crew session cannot attach a Google identity with another email', async () => {
    const name = `Hijack ${uid()}`;
    const { id, token } = await loginToken(name);
    const res = await oauth(oidcCode({ sub: `s${uid()}`, email: `other${uid()}@test.invalid` }), {}, token);
    expect(res.status).toBe(403);
    expect(await count('_externalAuths', `recordRef = "${id}"`)).toBe(0);
  });

  it('refuses blocked members and unverified emails', async () => {
    const name = `Benched ${uid()}`;
    const { id } = await loginToken(name);
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await oauth(oidcCode({ sub: `s${uid()}`, email: hexEmail(name) }))).status).toBe(403);
    expect((await oauth(oidcCode({ sub: `s${uid()}`, email: `u${uid()}@test.invalid`, email_verified: false }), { createData: { name: `Unverified ${uid()}` } })).status).toBe(403);
  });
});
