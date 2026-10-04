import { beforeEach, describe, expect, it } from 'vitest';
import { PB, clearMails, get, loginToken, mails, post, postFrom, randomIp, resetLinkFor, superuserToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const emailOf = (name: string) => `${Buffer.from(name.toLowerCase()).toString('hex')}@test.invalid`;
const SEED = 'seed-test-password-1';
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
// Each try comes from its own address: refusals are logged once per IP per 15 minutes, and the shared one belongs to other tests.
const signIn = (identity: string, password: string) => postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity, password });
const requestReset = (email: string) => post('/api/collections/users/request-password-reset', { email });
const confirm = (token: string, password: string) => post('/api/collections/users/confirm-password-reset', { token, password, passwordConfirm: password });
const block = async (id: string) => fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}
async function member() { const name = `Pw ${uid()}`; const { id, token } = await loginToken(name); return { id, token, name, email: emailOf(name) }; }

describe('password sign-in (spec §3.2)', () => {
  beforeEach(clearMails);

  it('signs in with email and password, through the guard, logged as password', async () => {
    const m = await member();
    const res = await signIn(m.email, SEED);
    expect(res.status).toBe(200);
    expect((await res.json()).record.id).toBe(m.id);
    expect((await logRows(`user = "${m.id}" && event = "signed_in" && method = "password"`)).length).toBe(1);
  });

  it('a wrong password and an unknown address get the same answer', async () => {
    const m = await member();
    const wrong = await signIn(m.email, 'wrong-password-1'), unknown = await signIn(`nobody${uid()}@test.invalid`, 'wrong-password-1');
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('the 11th try on one address in 15 minutes is refused, even with the right password', async () => {
    const m = await member();
    for (let i = 0; i < 10; i++) expect((await signIn(m.email, `wrong-password-${i}`)).status).toBe(400);
    const capped = await signIn(m.email, SEED);
    expect(capped.status).toBe(429);
    expect((await capped.json()).message).toContain('email code or Google');
    // The Conductor sees whose address was targeted. logEvent runs after the answer.
    const rows = await waitFor(async () => { const r = await logRows(`event="rate_limited" && detail="password" && email=${JSON.stringify(m.email)}`); return r.length ? r : null; });
    expect(rows[0].method).toBe('password');
  });

  it('the 11th try on an address with no seat gets the same 429 and message as for a member', async () => {
    const ghost = `nobody-${uid()}-${uid()}@test.invalid`;
    for (let i = 0; i < 10; i++) expect((await signIn(ghost, `wrong-password-${i}`)).status).toBe(400);
    const capped = await signIn(ghost, SEED);
    expect(capped.status).toBe(429);
    expect((await capped.json()).message).toBe('Too many tries for this address. Use an email code or Google, or try again in 15 minutes.');
    const rows = await waitFor(async () => { const r = await logRows(`event="rate_limited" && email=${JSON.stringify(ghost)}`); return r.length ? r : null; });
    expect(rows[0].detail).toBe('password');
  });
});

describe('password reset (spec §3.2)', () => {
  beforeEach(clearMails);

  it('mails a link into the app, with the token in the fragment, and logs it', async () => {
    const m = await member();
    expect((await requestReset(m.email)).status).toBe(204);
    const { url } = await resetLinkFor(m.email);
    expect(url.startsWith('http://127.0.0.1:15173/reset-password#')).toBe(true);
    expect((await mails(m.email)).at(-1)?.subject).toBe('Set your Chug-a-Lug password');
    // Logged only after the send returns, and the sink can publish the message before that.
    await waitFor(async () => (await logRows(`user = "${m.id}" && event = "password_reset_sent"`)).length === 1);
  });

  it('an unknown address and a put-off seat get the same empty 204 and no mail', async () => {
    const m = await member();
    await block(m.id);
    for (const email of [`nobody${uid()}@test.invalid`, m.email]) {
      const res = await requestReset(email);
      expect(res.status, email).toBe(204);
      expect(await res.text(), email).toBe('');
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(await mails(m.email)).toEqual([]);
  });

  it('confirm sets the password, ends old sessions, is logged, and the link works once', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    expect((await confirm(token, 'brand-new-pass-1')).status).toBe(204);
    expect((await signIn(m.email, 'brand-new-pass-1')).status).toBe(200);
    expect((await signIn(m.email, SEED)).status).toBe(400);
    expect((await get('/api/crawl/me', m.token)).status).toBe(401);
    expect((await confirm(token, 'another-pass-22')).status).toBe(400);
    expect((await logRows(`user = "${m.id}" && event = "password_set"`)).length).toBe(1);
  });

  it('a link mailed before a put-off is dead', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    await block(m.id);
    expect((await confirm(token, 'brand-new-pass-1')).status).toBe(400);
  });

  it('a name change after a reset keeps the new password; a superuser can still set one', async () => {
    const m = await member();
    await requestReset(m.email);
    await confirm((await resetLinkFor(m.email)).token, 'brand-new-pass-1');
    const session = (await (await signIn(m.email, 'brand-new-pass-1')).json()).token;
    const rename = await fetch(`${PB}/api/collections/users/records/${m.id}`, { method: 'PATCH', headers: { Authorization: session, 'content-type': 'application/json' }, body: JSON.stringify({ name: `Pw Renamed ${uid()}` }) });
    expect(rename.status).toBe(200);
    expect((await signIn(m.email, 'brand-new-pass-1')).status).toBe(200);
    expect((await signIn(m.email, SEED)).status).toBe(400); // the old password stays dead after the rename
    const set = await fetch(`${PB}/api/collections/users/records/${m.id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ password: 'admin-set-pass-1', passwordConfirm: 'admin-set-pass-1' }) });
    expect(set.status).toBe(200);
    expect((await signIn(m.email, 'admin-set-pass-1')).status).toBe(200);
  });

  // Spec §6, races: fired together, like decisions.test's double decision. These cannot force an
  // interleaving, but each run gives it a real chance, and every outcome must hold the invariant.
  it('two confirmations of one link sent together: exactly one wins', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    const codes = (await Promise.all([confirm(token, 'race-pass-one-1'), confirm(token, 'race-pass-two-2')])).map((r) => r.status).sort();
    expect(codes).toEqual([204, 400]);
  });

  it('a put-off sent together with a confirmation: the seat ends put off and the old session is dead', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    const [confirmed] = await Promise.all([confirm(token, 'race-pass-one-1'), block(m.id)]);
    const user = await (await fetch(`${PB}/api/collections/users/records/${m.id}`, { headers: await su() })).json();
    expect(user.blocked).toBe(true);
    expect((await get('/api/crawl/me', m.token)).status).toBe(401);
    // 403 if the confirmation landed first (the new password is set, the guard refuses the seat);
    // 400 if the put-off did (the link was refused, so the new password never existed).
    expect((await signIn(m.email, 'race-pass-one-1')).status).toBe(confirmed.status === 204 ? 403 : 400);
  });

  it('a rename sent together with a confirmation never brings the old password back', async () => {
    const m = await member();
    await requestReset(m.email);
    const { token } = await resetLinkFor(m.email);
    const rename = fetch(`${PB}/api/collections/users/records/${m.id}`, { method: 'PATCH', headers: { Authorization: m.token, 'content-type': 'application/json' }, body: JSON.stringify({ name: `Pw Racer ${uid()}` }) });
    const [set] = await Promise.all([confirm(token, 'race-pass-one-1'), rename]);
    expect(set.status).toBe(204);
    expect((await signIn(m.email, 'race-pass-one-1')).status).toBe(200);
    expect((await signIn(m.email, SEED)).status).toBe(400);
  });

  it('confirmation applies PocketBase\'s own rule: code points and 72 bytes, like /join', async () => {
    for (const [password, ok] of [['😀'.repeat(4), false], ['é'.repeat(36) + 'a', false], ['😀'.repeat(8), true]] as const) {
      const m = await member();
      await requestReset(m.email);
      expect((await confirm((await resetLinkFor(m.email)).token, password)).status, password).toBe(ok ? 204 : 400);
    }
  });
});
