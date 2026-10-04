import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, codeFor, loginToken, mailMode, mails, postFrom, randomIp, runCron, superuserToken, truncate, turnstileToken, waitFor } from './setup';

const uid = () => Math.floor(Math.random() * 1e6);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
const join = (ip: string, body: Record<string, unknown>) => postFrom(ip, '/api/crawl/join', { turnstile: turnstileToken(), password: 'boarding-pass-1', ...body });
/** Requests written directly by the superuser, to reach the global caps without 20 IPs of joins. */
async function seedRequests(count: number, status: 'unverified' | 'waiting') {
  for (let i = 0; i < count; i++) await fetch(`${PB}/api/collections/boarding_requests/records`, { method: 'POST', headers: await su(),
    body: JSON.stringify({ name: `Seed ${uid()}`, name_key: `seed ${uid()}`, email: `seed${uid()}@test.invalid`, method: 'email', status,
      ip: randomIp(), status_at: new Date().toISOString().replace('T', ' '), code_sent_at: new Date().toISOString().replace('T', ' ') }) });
}
async function verified(ip: string, name = `Waiter ${uid()}`) {
  const email = `v${uid()}@test.invalid`;
  const r = await (await join(ip, { name, email })).json();
  return postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
}
async function row(id: string) { return (await fetch(`${PB}/api/collections/boarding_requests/records/${id}`, { headers: await su() })).json(); }
async function backdate(id: string, field: 'status_at' | 'code_sent_at', minutes: number) {
  await fetch(`${PB}/api/collections/boarding_requests/records/${id}`, { method: 'PATCH', headers: await su(),
    body: JSON.stringify({ [field]: new Date(Date.now() - minutes * 60e3).toISOString().replace('T', ' ') }) });
}

describe('joining by email (spec §2.1–2.4)', () => {
  // The global caps (10 unverified, 20 waiting) would otherwise fill up across tests.
  beforeEach(async () => { await mailMode('ok'); await clearMails(); await truncate('boarding_requests'); });

  it('refuses a missing, short or four-emoji password', async () => {
    for (const password of [undefined, 'short1', '😀😀😀😀']) {
      const res = await join(randomIp(), { name: `NoPass ${uid()}`, email: `np${uid()}@test.invalid`, password });
      expect(res.status, String(password)).toBe(400);
      expect((await res.json()).message).toBe('Pick a password of 8 to 64 characters.');
    }
  });

  it('keeps only a bcrypt hash of the chosen password on the request', async () => {
    const r = await (await join(randomIp(), { name: `Hashed ${uid()}`, email: `h${uid()}@test.invalid` })).json();
    const stored = await row(r.request_id);
    expect(stored.password_hash).toMatch(/^\$2a\$10\$.{53}$/);
    expect(JSON.stringify(stored)).not.toContain('boarding-pass-1');
  });

  it('a decoy for a member stores a hash like any request and never touches the member\'s password', async () => {
    const n = uid();
    await loginToken(`Pw Member ${n}`);
    const memberEmail = `${Buffer.from(`pw member ${n}`).toString('hex')}@test.invalid`;
    const d = await (await join(randomIp(), { name: `Pw Taker ${n}`, email: memberEmail, password: 'takeover-pass-1' })).json();
    expect((await row(d.request_id)).password_hash).toMatch(/^\$2a\$/);
    const signIn = (password: string) => postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity: memberEmail, password });
    expect((await signIn('takeover-pass-1')).status).toBe(400);
    expect((await signIn('seed-test-password-1')).status).toBe(200);
  });

  it('a mail failure clears the hash, for a real request and a decoy alike', async () => {
    const n = uid();
    await loginToken(`Fail Member ${n}`);
    await mailMode('fail');
    for (const email of [`nomailpw${n}@test.invalid`, `${Buffer.from(`fail member ${n}`).toString('hex')}@test.invalid`]) {
      expect((await join(randomIp(), { name: `Fail ${uid()}`, email })).status, email).toBe(502);
      const q = new URLSearchParams({ filter: `email = "${email}"` });
      const rows = (await (await fetch(`${PB}/api/collections/boarding_requests/records?${q}`, { headers: await su() })).json()).items;
      expect(rows.map((x: { status: string; password_hash: string }) => [x.status, x.password_hash]), email).toEqual([['expired', '']]);
    }
    await mailMode('ok');
  });

  it('crew and the Conductor never see a request\'s password hash', async () => {
    const ip = randomIp(), email = `seen${uid()}@test.invalid`;
    const r = await (await join(ip, { name: `Seen ${uid()}`, email })).json();
    await postFrom(ip, '/api/crawl/join/verify', { ...r, code: await codeFor(email) });
    for (const who of [await loginToken(`Pw Crew ${uid()}`), await loginToken(`Pw Conductor ${uid()}`, ADMIN_LOGIN_PASSWORD)]) {
      const list = await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=200`, { headers: { Authorization: who.token } })).json();
      const view = await (await fetch(`${PB}/api/collections/boarding_requests/records/${r.request_id}`, { headers: { Authorization: who.token } })).json();
      expect(list.items.some((x: { id: string }) => x.id === r.request_id)).toBe(true);
      expect(JSON.stringify(list)).not.toContain('password_hash');
      expect(view.id).toBe(r.request_id);
      expect(view).not.toHaveProperty('password_hash');
    }
  });

  it('sends a code, verifies it once, and the request waits; replay is refused', async () => {
    const ip = randomIp(), email = `new${uid()}@test.invalid`;
    const res = await join(ip, { name: `Newbie ${uid()}`, email: `  ${email.toUpperCase()}  ` });
    expect(res.status).toBe(200);
    const { request_id, secret } = await res.json();
    const code = await codeFor(email);
    expect((await postFrom(ip, '/api/crawl/join/status', { request_id, secret }).then((r) => r.json())).status).toBe('unverified');
    expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code })).status).toBe(200);
    expect((await row(request_id)).status).toBe('waiting');
    expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code })).status).toBe(410);
    expect((await row(request_id)).status).toBe('waiting');
  });

  it('refuses a failed Turnstile, a bad name and a bad email', async () => {
    const ip = randomIp();
    expect((await join(ip, { name: 'Robot', email: `r${uid()}@test.invalid`, turnstile: 'nope' })).status).toBe(400);
    expect((await join(ip, { name: 'x', email: `r${uid()}@test.invalid` })).status).toBe(400);
    expect((await join(ip, { name: 'Fine Name', email: 'not-an-email' })).status).toBe(400);
  });

  it('a Turnstile outage answers 503 and is not logged as a failed check', async () => {
    const ip = randomIp();
    expect((await join(ip, { name: `Outage ${uid()}`, email: `o${uid()}@test.invalid`, turnstile: `down-${uid()}` })).status).toBe(503);
    const q = new URLSearchParams({ filter: `ip = "${ip}" && event = "turnstile_failed"` });
    expect((await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).totalItems).toBe(0);
  });

  it('refuses a name that differs from a member only by case and spacing', async () => {
    const n = uid();
    await loginToken(`Bob Smith${n}`);
    expect((await join(randomIp(), { name: `  bob   SMITH${n} `, email: `b${n}@test.invalid` })).status).toBe(409);
  });

  it('limits one IP to 5 joins an hour and 2 open unverified requests', async () => {
    const ip = randomIp();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await join(ip, { name: `Flood ${uid()}`, email: `f${uid()}@test.invalid` })).status);
    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429); // unverified cap per IP
    expect(statuses[5]).toBe(429); // hourly join limit
  });

  it('wrong codes count; the sixth try and an expired code are refused', async () => {
    const ip = randomIp(), email = `w${uid()}@test.invalid`;
    const { request_id, secret } = await (await join(ip, { name: `Wrong ${uid()}`, email })).json();
    for (let i = 0; i < 5; i++) expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code: '000000' })).status).toBe(400);
    expect((await postFrom(ip, '/api/crawl/join/verify', { request_id, secret, code: await codeFor(email) })).status).toBe(410);
    const second = await (await join(randomIp(), { name: `Late ${uid()}`, email: `l${uid()}@test.invalid` })).json();
    await backdate(second.request_id, 'code_sent_at', 16);
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...second, code: '123456' })).status).toBe(410);
  });

  it('a wrong secret is a 404 everywhere', async () => {
    const ip = randomIp();
    const { request_id } = await (await join(ip, { name: `Secret ${uid()}`, email: `s${uid()}@test.invalid` })).json();
    for (const path of ['status', 'verify', 'resend']) expect((await postFrom(ip, `/api/crawl/join/${path}`, { request_id, secret: 'x', code: '1' })).status).toBe(404);
  });

  it('resend is throttled to once a minute, then rotates the code', async () => {
    const ip = randomIp(), email = `a${uid()}@test.invalid`;
    const r = await (await join(ip, { name: `Again ${uid()}`, email })).json();
    expect((await postFrom(ip, '/api/crawl/join/resend', r)).status).toBe(429);
    const old = await codeFor(email);
    await backdate(r.request_id, 'code_sent_at', 2);
    expect((await postFrom(ip, '/api/crawl/join/resend', r)).status).toBe(200);
    const fresh = await waitFor(async () => { const c = await codeFor(email); return c !== old && c; });
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code: old })).status).toBe(400);
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code: fresh })).status).toBe(200);
  });

  it('a request gets at most three resends, decoy or not', async () => {
    const n = uid();
    await loginToken(`Capped Member ${n}`);
    const memberEmail = `${Buffer.from(`capped member ${n}`).toString('hex')}@test.invalid`;
    for (const email of [`cap${n}@test.invalid`, memberEmail]) {
      const ip = randomIp();
      const r = await (await join(ip, { name: `Capped ${uid()}`, email })).json();
      for (let i = 1; i <= 3; i++) {
        await backdate(r.request_id, 'code_sent_at', 2);
        expect((await postFrom(ip, '/api/crawl/join/resend', r)).status, `${email} resend ${i}`).toBe(200);
      }
      await backdate(r.request_id, 'code_sent_at', 2);
      await clearMails();
      const fourth = await postFrom(ip, '/api/crawl/join/resend', r);
      expect(fourth.status, email).toBe(429);
      expect((await fourth.json()).message).toBe("That's enough codes for now. Start again later.");
      await new Promise((res) => setTimeout(res, 300));
      expect(await mails(email)).toEqual([]);
    }
  });

  it('concurrent joins from one IP cannot beat the unverified cap', async () => {
    const ip = randomIp();
    const statuses = await Promise.all([1, 2, 3, 4].map(() => join(ip, { name: `Race ${uid()}`, email: `race${uid()}@test.invalid` }).then((r) => r.status)));
    expect(statuses.filter((x) => x === 200)).toHaveLength(2);
  });

  it('the global caps hold: 10 unverified at join, 20 waiting at verify', async () => {
    await seedRequests(10, 'unverified');
    expect((await join(randomIp(), { name: `Late ${uid()}`, email: `l${uid()}@test.invalid` })).status).toBe(429);
    await truncate('boarding_requests');
    await seedRequests(20, 'waiting');
    expect((await verified(randomIp())).status).toBe(429);
  });

  it('the global caps admit the last slot: 9 unverified at join, 19 waiting at verify', async () => {
    await seedRequests(9, 'unverified');
    expect((await join(randomIp(), { name: `Ninth ${uid()}`, email: `n${uid()}@test.invalid` })).status).toBe(200);
    await truncate('boarding_requests');
    await seedRequests(19, 'waiting');
    expect((await verified(randomIp())).status).toBe(200);
  });

  it('a full queue spends no code attempts: the right code still verifies once a slot frees', async () => {
    await seedRequests(20, 'waiting');
    const ip = randomIp(), email = `q${uid()}@test.invalid`;
    const r = await (await join(ip, { name: `Queued ${uid()}`, email })).json();
    const code = await codeFor(email);
    for (let i = 0; i < 5; i++) expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code })).status).toBe(429);
    expect((await row(r.request_id)).code_attempts).toBe(0);
    const q = new URLSearchParams({ filter: 'status = "waiting"', perPage: '100' });
    for (const x of (await (await fetch(`${PB}/api/collections/boarding_requests/records?${q}`, { headers: await su() })).json()).items as Array<{ id: string }>) {
      await fetch(`${PB}/api/collections/boarding_requests/records/${x.id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify({ status: 'expired' }) });
    }
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...r, code })).status).toBe(200);
  });

  it('one IP keeps at most 3 requests waiting', async () => {
    const ip = randomIp();
    for (let i = 0; i < 3; i++) expect((await verified(ip)).status).toBe(200);
    expect((await verified(ip)).status).toBe(429);
  });

  it('an unverified request holds no name; the second to verify a shared name loses it', async () => {
    const shared = `Twin ${uid()}`, ip1 = randomIp(), ip2 = randomIp(), e1 = `t1${uid()}@test.invalid`, e2 = `t2${uid()}@test.invalid`;
    const a = await (await join(ip1, { name: shared, email: e1 })).json();
    const b = await join(ip2, { name: shared, email: e2 });
    expect(b.status).toBe(200);
    expect((await postFrom(ip1, '/api/crawl/join/verify', { ...a, code: await codeFor(e1) })).status).toBe(200);
    const second = await b.json();
    expect((await postFrom(ip2, '/api/crawl/join/verify', { ...second, code: await codeFor(e2) })).status).toBe(409);
    expect((await row(second.request_id)).code_attempts).toBe(0); // only a wrong code counts
  });

  it('repeat sign-ups return the same request id, for a member address and a fresh one alike', async () => {
    const n = uid();
    await loginToken(`Repeat ${n}`);
    const memberEmail = `${Buffer.from(`repeat ${n}`).toString('hex')}@test.invalid`, freshEmail = `fresh2${n}@test.invalid`;
    for (const email of [memberEmail, freshEmail]) {
      const one = await (await join(randomIp(), { name: `One ${uid()}`, email })).json();
      const two = await (await join(randomIp(), { name: `Two ${uid()}`, email })).json();
      expect(two.request_id, email).toBe(one.request_id);
    }
  });

  it('a member email gets a decoy that behaves like a real request, and a "you have a seat" mail', async () => {
    const n = uid();
    await loginToken(`Member ${n}`);
    const memberEmail = `${Buffer.from(`member ${n}`).toString('hex')}@test.invalid`;
    const ip = randomIp();
    const decoy = await join(ip, { name: `Other ${n}`, email: memberEmail }); // repeat-id parity is its own test above
    const fresh = await join(randomIp(), { name: `Fresh ${n}`, email: `fresh${n}@test.invalid` });
    expect(decoy.status).toBe(fresh.status);
    const d = await decoy.json(), f = await fresh.json();
    expect(Object.keys(d).sort()).toEqual(Object.keys(f).sort());
    expect((await postFrom(ip, '/api/crawl/join/status', d).then((r) => r.json())).status).toBe('unverified');
    expect((await postFrom(ip, '/api/crawl/join/verify', { ...d, code: '123456' })).status).toBe(400);
    expect((await mails(memberEmail)).at(-1)?.text).toContain('already have a seat');
    const crew = await loginToken(`Viewer ${n}`);
    const list = await (await fetch(`${PB}/api/collections/boarding_requests/records?perPage=200`, { headers: { Authorization: crew.token } })).json();
    expect(list.items.some((x: { id: string }) => x.id === d.request_id)).toBe(false);
  });

  it('a second sign-up for a waiting email leaves the waiting request untouched', async () => {
    const ip = randomIp(), email = `twice${uid()}@test.invalid`;
    const first = await (await join(ip, { name: `Twice ${uid()}`, email })).json();
    await postFrom(ip, '/api/crawl/join/verify', { ...first, code: await codeFor(email) });
    await clearMails();
    const again = await join(randomIp(), { name: `Twice Again ${uid()}`, email });
    expect(again.status).toBe(200);
    expect((await row(first.request_id)).status).toBe('waiting');
    expect((await mails(email)).at(-1)?.text).toContain('already waiting');
  });

  it('a decoy resend repeats the notice that matches its address', async () => {
    const n = uid();
    await loginToken(`Resend Member ${n}`);
    const memberEmail = `${Buffer.from(`resend member ${n}`).toString('hex')}@test.invalid`, waitingEmail = `rw${n}@test.invalid`;
    const first = await (await join(randomIp(), { name: `Resend Waiter ${n}`, email: waitingEmail })).json();
    expect((await postFrom(randomIp(), '/api/crawl/join/verify', { ...first, code: await codeFor(waitingEmail) })).status).toBe(200);
    for (const [email, notice] of [[memberEmail, 'already have a seat'], [waitingEmail, 'already waiting']]) {
      const d = await (await join(randomIp(), { name: `Resend Decoy ${uid()}`, email })).json();
      await backdate(d.request_id, 'code_sent_at', 2);
      await clearMails();
      expect((await postFrom(randomIp(), '/api/crawl/join/resend', d)).status).toBe(200);
      expect((await mails(email)).at(-1)?.text, email).toContain(notice);
    }
  });

  it('a mail failure answers 502 and expires the request', async () => {
    await mailMode('fail');
    const email = `nomail${uid()}@test.invalid`;
    const res = await join(randomIp(), { name: `NoMail ${uid()}`, email });
    expect(res.status).toBe(502);
    await mailMode('ok');
    const q = new URLSearchParams({ filter: `email = "${email}"` });
    const rows = (await (await fetch(`${PB}/api/collections/boarding_requests/records?${q}`, { headers: await su() })).json()).items;
    expect(rows.map((x: { status: string }) => x.status)).toEqual(['expired']);
  });

  it('the sweep expires unverified requests after 30 min', async () => {
    const r = await (await join(randomIp(), { name: `Stale ${uid()}`, email: `stale${uid()}@test.invalid` })).json();
    await backdate(r.request_id, 'status_at', 31);
    await runCron('boarding_sweep');
    await waitFor(async () => (await row(r.request_id)).status === 'expired');
    expect((await row(r.request_id)).password_hash).toBe('');
  });

  it('the sweep expires waiting requests after 72 h and leaves younger ones alone', async () => {
    const idFrom = async (ip: string) => {
      expect((await verified(ip)).status).toBe(200);
      const q = new URLSearchParams({ filter: `ip = "${ip}"` });
      return (await (await fetch(`${PB}/api/collections/boarding_requests/records?${q}`, { headers: await su() })).json()).items[0].id as string;
    };
    const old = await idFrom(randomIp()), youngId = await idFrom(randomIp());
    await backdate(old, 'status_at', 72 * 60 + 1);
    await backdate(youngId, 'status_at', 71 * 60);
    await runCron('boarding_sweep');
    await waitFor(async () => (await row(old)).status === 'expired');
    expect((await row(youngId)).status).toBe('waiting');
  });
});
