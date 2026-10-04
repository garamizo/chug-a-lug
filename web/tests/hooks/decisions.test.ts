import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, codeFor, get, loginToken, mailMode, mails, post, postFrom, randomIp, runCron, superuserToken, truncate, turnstileToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function waitingRequest(name = `Guest ${uid()}`) {
  const ip = randomIp(), email = `g${uid()}@test.invalid`;
  const r = await (await postFrom(ip, '/api/crawl/join', { name, email, password: 'boarding-pass-1', turnstile: turnstileToken() })).json();
  await postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
  return { ...r, email, name, ip };
}
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}
const decide = (id: string, verdict: 'let-aboard' | 'turn-away', token?: string) => post(`/api/crawl/boarding/${id}/${verdict}`, {}, token);
/** An SSE connection to PocketBase's realtime API, subscribed with `token`; events collect in `events`. */
async function listen(token: string, subscriptions: string[]) {
  const ctrl = new AbortController();
  const res = await fetch(`${PB}/api/realtime`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ name: string; data: any }> = [];
  let buffer = '', connect: (id: string) => void = () => {};
  const connected = new Promise<string>((r) => (connect = r));
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
          const chunk = buffer.slice(0, i); buffer = buffer.slice(i + 2);
          const name = /^event:(.*)$/m.exec(chunk)?.[1].trim() ?? '';
          const data = JSON.parse(/^data:(.*)$/m.exec(chunk)?.[1] ?? 'null');
          if (name === 'PB_CONNECT') connect(data.clientId); else events.push({ name, data });
        }
      }
    } catch { /* aborted */ }
  })();
  const clientId = await connected;
  const sub = await post('/api/realtime', { clientId, subscriptions }, token);
  if (sub.status !== 204) throw new Error(`Subscribe failed: ${sub.status}`);
  return { events, close: () => ctrl.abort() };
}

describe('deciding boarding requests (spec §2.6–2.7)', () => {
  beforeEach(async () => { await mailMode('ok'); await clearMails(); await truncate('boarding_requests'); });
  afterEach(() => mailMode('ok'));

  it('a request filed before passwords existed is let aboard with the email-or-Google notice', async () => {
    const crew = await loginToken(`Old Voucher ${uid()}`);
    const email = `old${uid()}@test.invalid`, n = uid();
    const seeded = await (await fetch(`${PB}/api/collections/boarding_requests/records`, { method: 'POST', headers: await su(),
      body: JSON.stringify({ name: `Old ${n}`, name_key: `old ${n}`, email, method: 'email', status: 'waiting', ip: randomIp(),
        status_at: new Date().toISOString().replace('T', ' '), code_sent_at: new Date().toISOString().replace('T', ' ') }) })).json();
    expect((await decide(seeded.id, 'let-aboard', crew.token)).status).toBe(200);
    expect((await mails(email)).at(-1)?.text).toContain('an emailed code or Google');
  });

  it('any crew member lets a guest aboard with the chosen password; the guest can also sign in by code', async () => {
    const crew = await loginToken(`Voucher ${uid()}`);
    const g = await waitingRequest();
    const res = await decide(g.request_id, 'let-aboard', crew.token);
    expect(res.status).toBe(200);
    const user = await (await fetch(`${PB}/api/collections/users/records/${(await res.json()).user_id}`, { headers: await su() })).json();
    expect(user).toMatchObject({ email: g.email, verified: true, approved_by: crew.id, name: g.name });
    expect((await mails(g.email)).at(-1)?.subject).toContain('aboard');
    // Let aboard installs the chosen password, clears the hash and says so in the mail.
    expect((await mails(g.email)).at(-1)?.text).toContain('the password you chose');
    expect((await post('/api/collections/users/auth-with-password', { identity: g.email, password: 'boarding-pass-1' })).status).toBe(200);
    const req = await (await fetch(`${PB}/api/collections/boarding_requests/records/${g.request_id}`, { headers: await su() })).json();
    expect(req.password_hash).toBe('');
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
    // Turning a request away clears its hash.
    const req = await (await fetch(`${PB}/api/collections/boarding_requests/records/${g.request_id}`, { headers: await su() })).json();
    expect(req.password_hash).toBe('');
  });

  it('a Conductor notice that fails to send is retried by the sweep', async () => {
    // The code must reach the guest first; only the notice at verify time should fail.
    const ip = randomIp(), email = `n${uid()}@test.invalid`;
    const r = await (await postFrom(ip, '/api/crawl/join', { name: `Notice ${uid()}`, email, password: 'boarding-pass-1', turnstile: turnstileToken() })).json();
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

  it('a put-off person stops receiving realtime events at once', async () => {
    const boss = await loginToken(`Dispatcher ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Listener ${uid()}`);
    const itinerary = (await (await post('/api/collections/itineraries/records', { title: `Realtime ${uid()}`, event_date: '2026-12-26', start_time: '12:00' }, boss.token)).json()).id;
    const stream = await listen(rider.token, ['chat_messages']);
    const control = await listen(boss.token, ['chat_messages']);   // never blocked: proves 'after' was broadcast
    try {
      const say = async (body: string) => expect((await post('/api/collections/chat_messages/records', { itinerary, user: boss.id, body }, await superuserToken())).status).toBe(200);
      await say('before');
      await waitFor(async () => stream.events.some((ev) => ev.data?.record?.body === 'before'), 5000); // the control: events do arrive
      expect((await post(`/api/crawl/users/${rider.id}/put-off`, {}, boss.token)).status).toBe(200);
      await say('after');
      await waitFor(async () => control.events.some((ev) => ev.data?.record?.body === 'after'), 5000);
      await new Promise((r) => setTimeout(r, 100));   // grace for a late delivery to the rider
      expect(stream.events.some((ev) => ev.data?.record?.body === 'after')).toBe(false);
    } finally { stream.close(); control.close(); }
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
