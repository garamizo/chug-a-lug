import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, codeFor, get, loginToken, mailMode, mails, post, postFrom, randomIp, runCron, superuserToken, truncate, turnstileToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function waitingRequest(name = `Guest ${uid()}`) {
  const ip = randomIp(), email = `g${uid()}@test.invalid`;
  const r = await (await postFrom(ip, '/api/crawl/join', { name, email, turnstile: turnstileToken() })).json();
  await postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
  return { ...r, email, name, ip };
}
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}
const decide = (id: string, verdict: 'let-aboard' | 'turn-away', token?: string) => post(`/api/crawl/boarding/${id}/${verdict}`, {}, token);

describe('deciding boarding requests (spec §2.6–2.7)', () => {
  beforeEach(async () => { await mailMode('ok'); await clearMails(); await truncate('boarding_requests'); });
  afterEach(() => mailMode('ok'));

  it('any crew member lets a guest aboard; the guest then signs in by code', async () => {
    const crew = await loginToken(`Voucher ${uid()}`);
    const g = await waitingRequest();
    const res = await decide(g.request_id, 'let-aboard', crew.token);
    expect(res.status).toBe(200);
    const user = await (await fetch(`${PB}/api/collections/users/records/${(await res.json()).user_id}`, { headers: await su() })).json();
    expect(user).toMatchObject({ email: g.email, verified: true, approved_by: crew.id, name: g.name });
    expect((await mails(g.email)).at(-1)?.subject).toContain('aboard');
    expect((await postFrom(g.ip, '/api/crawl/join/status', g).then((r) => r.json())).status).toBe('aboard');
    await clearMails();
    const { otpId } = await (await post('/api/collections/users/request-otp', { email: g.email })).json();
    expect((await post('/api/collections/users/auth-with-otp', { otpId, password: await codeFor(g.email) })).status).toBe(200);
  });

  it('a double decision gets one 200 and one 409, even when sent together', async () => {
    const a = await loginToken(`Fast ${uid()}`), b = await loginToken(`Slow ${uid()}`);
    const g = await waitingRequest();
    const statuses = (await Promise.all([decide(g.request_id, 'let-aboard', a.token), decide(g.request_id, 'turn-away', b.token)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('guests and blocked crew cannot decide', async () => {
    const g = await waitingRequest();
    expect((await decide(g.request_id, 'let-aboard')).status).toBe(401);
    const blocked = await loginToken(`Benched ${uid()}`);
    await fetch(`${PB}/api/collections/users/records/${blocked.id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ blocked: true }) });
    expect((await decide(g.request_id, 'let-aboard', blocked.token)).status).toBe(401);
  });

  it('crew see waiting and recently decided requests only; guests see none', async () => {
    const crew = await loginToken(`Reader ${uid()}`);
    const g = await waitingRequest();
    const list = async (token?: string) => (await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=500`, { headers: token ? { Authorization: token } : {} })).json()).items as any[];
    expect((await list()).length).toBe(0);
    expect((await list(crew.token)).some((x) => x.id === g.request_id && x.status === 'waiting')).toBe(true);
    await decide(g.request_id, 'turn-away', crew.token);
    expect((await list(crew.token)).some((x) => x.id === g.request_id && x.status === 'turned_away')).toBe(true);
  });

  it('a Conductor notice that fails to send is retried by the sweep', async () => {
    // The code must reach the guest first; only the notice at verify time should fail.
    const ip = randomIp(), email = `n${uid()}@test.invalid`;
    const r = await (await postFrom(ip, '/api/crawl/join', { name: `Notice ${uid()}`, email, turnstile: turnstileToken() })).json();
    const code = await codeFor(email);
    await mailMode('fail');
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code })).status).toBe(200); // the decision path never fails on mail
    await mailMode('ok');
    await clearMails();
    await runCron('boarding_sweep');
    await waitFor(async () => (await mails('conductor@test.invalid')).some((m) => m.text.includes(email)), 10_000);
  });

  it('a failed "you are aboard" email still lets the guest aboard', async () => {
    const crew = await loginToken(`Mailless ${uid()}`);
    const g = await waitingRequest();
    await mailMode('fail');
    const res = await decide(g.request_id, 'let-aboard', crew.token);
    expect(res.status).toBe(200);
    const { user_id } = await res.json();
    expect((await fetch(`${PB}/api/collections/users/records/${user_id}`, { headers: await su() })).status).toBe(200);
    expect((await logRows(`event = "mail_failed" && user = "${user_id}"`)).length).toBe(1);
  });
});

describe('put off, manifest and names (spec §2.9–2.11)', () => {
  it('only a Conductor puts someone off; their token dies; no self put-off', async () => {
    const boss = await loginToken(`Chief ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Rider ${uid()}`);
    expect((await post(`/api/crawl/users/${boss.id}/put-off`, {}, rider.token)).status).toBe(403);
    expect((await post(`/api/crawl/users/${boss.id}/put-off`, {}, boss.token)).status).toBe(400);
    expect((await get('/api/crawl/me', rider.token)).status).toBe(200);
    expect((await post(`/api/crawl/users/${rider.id}/put-off`, {}, boss.token)).status).toBe(200);
    expect((await get('/api/crawl/me', rider.token)).status).toBe(401);
    // A list rule filters rather than rejects (200, zero rows), so prove the token is dead where PocketBase must reject it.
    expect((await fetch(`${PB}/api/collections/users/auth-refresh`, { method: 'POST', headers: { Authorization: rider.token } })).status).toBe(401);
    expect((await (await fetch(`${PB}/api/collections/users/records`, { headers: { Authorization: rider.token } })).json()).items).toEqual([]);
    expect((await post(`/api/crawl/users/${rider.id}/let-back-on`, {}, boss.token)).status).toBe(200);
  });

  it('the manifest shows emails to Conductors only', async () => {
    const boss = await loginToken(`Lister ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Peeker ${uid()}`);
    expect((await fetch(`${PB}/api/crawl/manifest`, { headers: { Authorization: rider.token } })).status).toBe(403);
    const m = await (await fetch(`${PB}/api/crawl/manifest`, { headers: { Authorization: boss.token } })).json();
    expect(m.people.find((p: { id: string }) => p.id === rider.id).email).toMatch(/@test\.invalid$/);
    expect(Array.isArray(m.log)).toBe(true);
  });

  it('a name change is normalised, unique and logged', async () => {
    const n = uid();
    const a = await loginToken(`Alpha ${n}`);
    await loginToken(`Taken ${n}`);
    const rename = (name: string) => fetch(`${PB}/api/collections/users/records/${a.id}`, { method: 'PATCH', headers: { Authorization: a.token, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    expect((await rename(`  taken   ${n} `)).status).toBe(409);
    expect((await rename('x')).status).toBe(400);
    const ok = await rename(`  Omega   ${n} `);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ name: `Omega ${n}`, name_key: `omega ${n}` });
    const row = await logRows(`event = "name_changed" && user = "${a.id}"`);
    expect(row.length).toBe(1);
    expect(row[0]).toMatchObject({ actor: a.id, name: `Omega ${n}` });
    expect(row[0].detail).toContain(`was Alpha ${n}`);
    // Whitespace or case only: saved normalised, but nothing to report.
    const same = await rename(`  omega   ${n}`);
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ name: `omega ${n}` });
    expect((await logRows(`event = "name_changed" && user = "${a.id}"`)).length).toBe(1);
  });

  it('a superuser rename is saved and logged without an actor; a superuser block ends sessions', async () => {
    const n = uid();
    const u = await loginToken(`Sued ${n}`);
    const patch = async (body: object) => fetch(`${PB}/api/collections/users/records/${u.id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify(body) });
    const ok = await patch({ name: `  Renamed   ${n} ` });
    expect(ok.status).toBe(200);
    const rows = await logRows(`event = "name_changed" && user = "${u.id}"`);
    expect(rows.length).toBe(1);
    expect(rows[0].actor).toBe('');
    expect(rows[0].detail).toContain('by superuser');
    expect(rows[0].detail).toContain(`was Sued ${n}`);
    expect((await get('/api/crawl/me', u.token)).status).toBe(200);
    expect((await patch({ blocked: true })).status).toBe(200);
    expect((await get('/api/crawl/me', u.token)).status).toBe(401);
  });
});
