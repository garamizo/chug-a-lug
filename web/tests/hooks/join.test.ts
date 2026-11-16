import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, codeFor, invite, loginToken, mailMode, mails, post, postFrom, randomIp, runCron, superuserToken, truncate, waitFor } from './setup';

// Spec 2026-11-15-join-link-design.md §4.2. Rate-limit buckets live in _crawl_limits, which truncate
// never resets: every budget test brings its own link, addresses and IPs.
const LINK = 'This link is used up or expired. Ask the Conductor for a new one.';
const EXPIRED = 'That code expired. Start again.';
const BUSY = 'Too many sign-ups right now. Try again in an hour.';
const PASS = 'join-pass-word-1';
const SECRET = process.env.INTERNAL_SECRET ?? '';
const uid = () => Math.floor(Math.random() * 1e9);
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ');

let link: { token: string };
type SignUp = { status: number; json: any; token: string; name: string; email: string; password: string };
/** Posts a valid sign-up form for the current link from `ip`; overrides replace any field. */
async function signUp(ip: string, overrides: Record<string, unknown> = {}): Promise<SignUp> {
  const body = { token: link.token, name: `Joiner ${uid()}`, email: `j${uid()}@test.invalid`, password: PASS, ...overrides };
  const res = await postFrom(ip, '/api/crawl/join', body);
  return { status: res.status, json: await res.json(), ...(body as any) };
}
const verify = (ip: string, s: SignUp, code: string) => postFrom(ip, '/api/crawl/join/verify', { signup_id: s.json.signup_id, secret: s.json.secret, code });
const resend = (ip: string, s: SignUp) => postFrom(ip, '/api/crawl/join/resend', { signup_id: s.json.signup_id, secret: s.json.secret });
const wrong = (code: string) => String((Number(code) + 1) % 1e6).padStart(6, '0');
async function message(res: Response) { return (await res.json()).message; }

async function row(id: string) { return fetch(`${PB}/api/collections/signups/records/${id}`, { headers: await su() }); }
async function patchRow(id: string, body: unknown) {
  const res = await fetch(`${PB}/api/collections/signups/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Patch signup failed: ${res.status} ${await res.text()}`);
}
const backdate = (s: SignUp, field: 'code_sent_at' | 'expires_at', seconds: number) => patchRow(s.json.signup_id, { [field]: sqlTime(Date.now() - seconds * 1000) });
async function currentLinkId() {
  const q = new URLSearchParams({ filter: "revoked_at = ''", sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/join_links/records?${q}`, { headers: await su() })).json()).items[0].id as string;
}
async function patchLink(body: unknown) {
  const res = await fetch(`${PB}/api/collections/join_links/records/${await currentLinkId()}`, { method: 'PATCH', headers: await su(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Patch link failed: ${res.status}`);
}
async function seatsLeft() {
  const res = await fetch(`${PB}/api/crawl/invite`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': SECRET }, body: JSON.stringify({ action: 'status' }) });
  return (await res.json()).seats_left as number;
}
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}
async function usersWith(emails: string[]) {
  const q = new URLSearchParams({ filter: emails.map((e) => `email = ${JSON.stringify(e)}`).join(' || ') });
  return (await (await fetch(`${PB}/api/collections/users/records?${q}`, { headers: await su() })).json()).items as any[];
}

describe('join link sign-up (spec §4.2)', () => {
  beforeEach(async () => { await mailMode('ok'); await clearMails(); await truncate('signups'); link = await invite(5); });
  afterEach(() => mailMode('ok'));

  it('a dead link answers the link message', async () => {
    const ip = randomIp();
    const check = await postFrom(ip, '/api/crawl/join/link', { token: link.token });
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({});
    const dead = async (what: string) => {
      const res = await postFrom(ip, '/api/crawl/join/link', { token: link.token });
      expect(res.status, what).toBe(410);
      expect(await message(res), what).toBe(LINK);
      const s = await signUp(ip);
      expect(s.status, what).toBe(410);
      expect(s.json.message, what).toBe(LINK);
    };
    const live = link;
    link = { token: `nope${uid()}` };
    await dead('unknown');
    link = live;
    await invite(5);
    await dead('revoked');
    link = await invite(5);
    await patchLink({ expires_at: '2020-01-01 00:00:00.000Z' });
    await dead('expired');
    link = await invite(5);
    await patchLink({ seats_left: 0 });
    await dead('full');
    expect((await (await fetch(`${PB}/api/collections/signups/records`, { headers: await su() })).json()).items).toEqual([]);
  });

  it('invalid name, email or password costs no budget', async () => {
    const ip = randomIp();
    const bad = [
      ...Array.from({ length: 7 }, () => ({ name: 'x' })),
      ...Array.from({ length: 7 }, () => ({ email: 'not-an-email' })),
      ...Array.from({ length: 7 }, () => ({ password: 'short' }))
    ];
    for (const overrides of bad) expect((await signUp(ip, overrides)).status, JSON.stringify(overrides)).toBe(400);
    expect((await signUp(ip, { password: '😀😀😀😀' })).json.message).toBe('Pick a password of 8 to 64 characters.');
    expect((await signUp(ip)).status).toBe(200);
  }, 30_000);

  it('ten emails from one IP all get codes', async () => {
    const ip = randomIp();
    const people = [];
    for (let i = 0; i < 10; i++) people.push(await signUp(ip));
    expect(people.map((p) => p.status)).toEqual(Array(10).fill(200));
    for (const p of people) {
      expect(p.json).toEqual({ signup_id: expect.any(String), secret: expect.any(String) });
      expect(await codeFor(p.email)).toMatch(/^\d{6}$/);
    }
  }, 30_000);

  it('an email that has a seat is told to sign in', async () => {
    const n = uid();
    await loginToken(`Seated ${n}`);
    const seated = await signUp(randomIp(), { email: `${Buffer.from(`seated ${n}`).toString('hex')}@test.invalid` });
    expect(seated.status).toBe(409);
    expect(seated.json.message).toBe('That email already has a seat. Sign in instead.');
    const named = await signUp(randomIp(), { name: `SEATED ${n}` });
    expect(named.status).toBe(409);
    expect(named.json.message).toBe('That name is taken. Add an initial?');
  });

  it('the address budget covers sign-up and resend', async () => {
    const ip = randomIp(), email = `addr${uid()}@test.invalid`;
    const first = await signUp(ip, { email });
    expect(first.status).toBe(200);
    const second = await signUp(ip, { email });
    expect(second.status).toBe(200);
    expect((await row(first.json.signup_id)).status).toBe(404); // replaced
    await backdate(second, 'code_sent_at', 61);
    expect((await resend(ip, second)).status).toBe(200);
    expect((await mails(email)).length).toBe(3);
    const fourth = await signUp(ip, { email });
    expect(fourth.status).toBe(429);
    expect(fourth.json.message).toBe(BUSY);
    expect((await signUp(ip)).status).toBe(200);
  });

  it('the link budget caps a leaked link at 40 mails', async () => {
    link = await invite(50);
    const ips = [randomIp(), randomIp(), randomIp(), randomIp()];
    for (let i = 0; i < 40; i++) {
      if (i && i % 10 === 0) await truncate('signups');
      expect((await signUp(ips[Math.floor(i / 10)])).status, `sign-up ${i}`).toBe(200);
    }
    await truncate('signups');
    // A relative who keeps trying the spent link is refused, but their address budget stays whole.
    const relative = `relative${uid()}@test.invalid`;
    for (let i = 0; i < 3; i++) {
      const over = await signUp(randomIp(), { email: relative });
      expect(over.status, `try ${i}`).toBe(429);
      expect(over.json.message).toBe(BUSY);
    }
    link = await invite(5);
    expect((await signUp(randomIp(), { email: relative })).status).toBe(200);
  }, 60_000);

  it('at most ten open sign-ups', async () => {
    const ip = randomIp();
    const open = [];
    for (let i = 0; i < 10; i++) open.push(await signUp(ip));
    expect(open.every((s) => s.status === 200)).toBe(true);
    const eleventh = await signUp(ip);
    expect(eleventh.status).toBe(429);
    expect(eleventh.json.message).toBe(BUSY);
    expect((await signUp(ip, { email: open[3].email })).status).toBe(200);
  }, 30_000);

  it('a new link is not blocked by the open sign-ups of the one it replaced', async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) expect((await signUp(ip)).status, `sign-up ${i}`).toBe(200);
    expect((await signUp(ip)).status).toBe(429);
    link = await invite(5); // revokes the leaked link; its ten sign-ups can never finish
    expect((await signUp(randomIp())).status).toBe(200);
  }, 30_000);

  it('a mail-budget refusal costs no join budget', async () => {
    const ip = randomIp(), spent = `spent${uid()}@test.invalid`;
    // The address's three code mails, sent from elsewhere.
    for (let i = 0; i < 3; i++) expect((await signUp(randomIp(), { email: spent })).status, `mail ${i}`).toBe(200);
    // 19 of this IP's 20 sign-ups an hour (cleared halfway, so the open cap never answers).
    await truncate('signups');
    for (let i = 0; i < 19; i++) {
      if (i === 10) await truncate('signups');
      expect((await signUp(ip)).status, `sign-up ${i}`).toBe(200);
    }
    const refused = await signUp(ip, { email: spent });
    expect(refused.status).toBe(429);
    expect(refused.json.message).toBe(BUSY);
    link = await invite(5);
    expect((await signUp(ip)).status).toBe(200); // the twentieth: the refusal spent nothing
  }, 60_000);

  it('verify signs in and takes a seat', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    const res = await verify(ip, s, await codeFor(s.email));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.record.email).toBe(s.email);
    expect(body.record.name).toBe(s.name);
    expect((await post('/api/collections/users/auth-refresh', {}, body.token)).status).toBe(200);
    expect(await seatsLeft()).toBe(4);
    expect((await logRows(`event = "joined" && user = "${body.record.id}"`)).length).toBe(1);
    expect((await logRows(`event = "signed_in" && method = "password" && user = "${body.record.id}"`)).length).toBe(1);
    const stored = await (await row(s.json.signup_id)).json();
    expect(stored.user).toBe(body.record.id);
    expect(stored.password_hash).toBe('');
    expect((await postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity: s.email, password: PASS })).status).toBe(200);
  });

  it('normalised email signs in', async () => {
    const ip = randomIp(), n = uid();
    const s = await signUp(ip, { email: `  Mixed.Case${n}@Test.Invalid ` });
    expect(s.status).toBe(200);
    const email = `mixed.case${n}@test.invalid`;
    expect((await verify(ip, s, await codeFor(email))).status).toBe(200);
    expect((await postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity: email, password: PASS })).status).toBe(200);
  });

  it('two verifies for the last seat make one user', async () => {
    link = await invite(1);
    const ip = randomIp();
    const a = await signUp(ip), b = await signUp(ip);
    const [ca, cb] = [await codeFor(a.email), await codeFor(b.email)];
    const answers = await Promise.all([verify(ip, a, ca), verify(ip, b, cb)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(await message(answers.find((r) => r.status === 410)!)).toBe(LINK);
    expect((await usersWith([a.email, b.email])).length).toBe(1);
    expect(await seatsLeft()).toBe(0);
  });

  it('a repeated verify after success signs in again without a seat', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    const code = await codeFor(s.email);
    const first = await (await verify(ip, s, code)).json();
    const again = await verify(ip, s, code);
    expect(again.status).toBe(200);
    expect((await again.json()).record.id).toBe(first.record.id);
    expect(await seatsLeft()).toBe(4);
    expect((await verify(ip, s, wrong(code))).status).toBe(400);
    const boss = await loginToken(`Joiner Boss ${uid()}`, ADMIN_LOGIN_PASSWORD);
    expect((await post(`/api/crawl/users/${first.record.id}/put-off`, {}, boss.token)).status).toBe(200);
    expect((await verify(ip, s, code)).status).toBe(403);
  });

  it('wrong codes, old codes and expired sign-ups', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    const code = await codeFor(s.email);
    for (let i = 0; i < 5; i++) {
      const res = await verify(ip, s, wrong(code));
      expect(res.status, `wrong ${i}`).toBe(400);
      expect(await message(res)).toBe("That code isn't right.");
    }
    const late = await verify(ip, s, code);
    expect(late.status).toBe(410); // five wrong codes spent the sign-up's tries
    expect(await message(late)).toBe(EXPIRED);
    await clearMails();
    await backdate(s, 'code_sent_at', 61);
    expect((await resend(ip, s)).status).toBe(200);
    const fresh = await codeFor(s.email);
    expect((await verify(ip, s, code === fresh ? wrong(fresh) : code)).status).toBe(400);
    expect((await verify(ip, s, fresh)).status).toBe(200);

    const old = await signUp(ip);
    const oldCode = await codeFor(old.email);
    await backdate(old, 'code_sent_at', 16 * 60);
    expect((await verify(ip, old, oldCode)).status).toBe(410);
    const gone = await signUp(ip);
    const goneCode = await codeFor(gone.email);
    await backdate(gone, 'expires_at', 1);
    const res = await verify(ip, gone, goneCode);
    expect(res.status).toBe(410);
    expect(await message(res)).toBe(EXPIRED);
    expect(await seatsLeft()).toBe(4);
  });

  it('a wrong secret or unknown sign-up is a 404', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    const code = await codeFor(s.email);
    const forged = { ...s, json: { ...s.json, secret: 'not-the-secret' } };
    expect((await verify(ip, forged, code)).status).toBe(404);
    expect((await resend(ip, forged)).status).toBe(404);
    expect((await verify(ip, { ...s, json: { signup_id: 'nosuchsignup123', secret: s.json.secret } }, code)).status).toBe(404);
  });

  it('link revoked or expired between code and verify, and between code and resend', async () => {
    const ip = randomIp();
    const a = await signUp(ip), b = await signUp(ip);
    const codeB = await codeFor(b.email);
    await invite(5); // revokes the link both signed up with
    const refused = await resend(ip, a);
    expect(refused.status).toBe(410);
    expect(await message(refused)).toBe(LINK);
    const late = await verify(ip, b, codeB);
    expect(late.status).toBe(410);
    expect(await message(late)).toBe(LINK);
    expect((await row(b.json.signup_id)).status).toBe(404);

    link = await invite(5);
    const c = await signUp(ip), d = await signUp(ip);
    const codeD = await codeFor(d.email);
    await patchLink({ expires_at: sqlTime(Date.now() - 1000) });
    const refusedC = await resend(ip, c);
    expect(refusedC.status).toBe(410);
    expect(await message(refusedC)).toBe(LINK);
    const lateD = await verify(ip, d, codeD);
    expect(lateD.status).toBe(410);
    expect(await message(lateD)).toBe(LINK);
    expect((await row(d.json.signup_id)).status).toBe(404);
  });

  it('resend cooldown and count', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    const early = await resend(ip, s);
    expect(early.status).toBe(429);
    expect(await message(early)).toBe('Wait a minute before asking again.');
    // Three code mails an hour per address: the sign-up and two resends.
    for (let i = 0; i < 2; i++) {
      await backdate(s, 'code_sent_at', 61);
      expect((await resend(ip, s)).status, `resend ${i}`).toBe(200);
    }
    await backdate(s, 'code_sent_at', 61);
    expect((await resend(ip, s)).status).toBe(429);
    // A sign-up of its own is capped at three resends even with address budget to spare.
    const capped = await signUp(ip);
    await patchRow(capped.json.signup_id, { resends: 3, code_sent_at: sqlTime(Date.now() - 61_000) });
    expect((await resend(ip, capped)).status).toBe(429);
  });

  it('a failed resend can be retried', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    await backdate(s, 'code_sent_at', 61);
    await mailMode('fail');
    const failed = await resend(ip, s);
    expect(failed.status).toBe(502);
    expect(await message(failed)).toBe("Couldn't send the email. Try later.");
    await mailMode('ok');
    await clearMails();
    // The failed send still started the cooldown: an immediate retry waits like any resend.
    expect((await resend(ip, s)).status).toBe(429);
    await backdate(s, 'code_sent_at', 61);
    expect((await resend(ip, s)).status).toBe(200);
    expect((await verify(ip, s, await codeFor(s.email))).status).toBe(200);
  });

  // Spec 2026-11-15-festive-ticket-mail-design.md. The sink synthesises `text` from HTML when a mail
  // has no plain part, so exact equality with the plain wording proves the plain part was sent.
  it('the code mail is a ticket with the code in the subject, on send and resend', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    const ticket = (m: { subject: string; text: string; html: string }) => {
      const code = /data-code[^>]*>(\d{6})</.exec(m.html)?.[1];
      expect(code).toMatch(/^\d{6}$/);
      expect(m.subject).toBe(`${code} is your Chug-a-Lug boarding code`);
      expect(m.text).toBe(`Your Chug-a-Lug boarding code: ${code}\n\nIt works for 15 minutes.`);
      return code!;
    };
    await codeFor(s.email);
    const first = await mails(s.email);
    expect(first.length).toBe(1);
    ticket(first[0]);
    await backdate(s, 'code_sent_at', 61);
    expect((await resend(ip, s)).status).toBe(200);
    const both = await waitFor(async () => { const all = await mails(s.email); return all.length === 2 ? all : undefined; });
    const resent = ticket(both[1]);
    expect((await verify(ip, s, resent)).status).toBe(200);
  });

  it('resend refused with under 15 minutes left', async () => {
    const ip = randomIp();
    const s = await signUp(ip);
    await patchRow(s.json.signup_id, { expires_at: sqlTime(Date.now() + 10 * 60_000), code_sent_at: sqlTime(Date.now() - 61_000) });
    const res = await resend(ip, s);
    expect(res.status).toBe(410);
    expect(await message(res)).toBe(EXPIRED);
  });

  it('mail failure deletes the sign-up', async () => {
    await mailMode('fail');
    const s = await signUp(randomIp());
    expect(s.status).toBe(502);
    expect(s.json.message).toBe("Couldn't send the email. Try later.");
    const q = new URLSearchParams({ filter: `email = ${JSON.stringify(s.email)}` });
    expect((await (await fetch(`${PB}/api/collections/signups/records?${q}`, { headers: await su() })).json()).items).toEqual([]);
  });

  it('the sweep deletes expired sign-ups', async () => {
    const ip = randomIp();
    const old = await signUp(ip), young = await signUp(ip);
    await backdate(old, 'expires_at', 1);
    await runCron('join_sweep');
    await waitFor(async () => (await row(old.json.signup_id)).status === 404);
    expect((await row(young.json.signup_id)).status).toBe(200);
  });

  it('the Manifest answers people and log', async () => {
    const boss = await loginToken(`Manifest Boss ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const m = await (await fetch(`${PB}/api/crawl/manifest`, { headers: { Authorization: boss.token } })).json();
    expect(Object.keys(m).sort()).toEqual(['log', 'people']);
    expect(m.people.length).toBeGreaterThan(0);
    for (const p of m.people) expect(p).not.toHaveProperty('approved_by');
  });

  it('the link check is limited to 30 an hour per IP', async () => {
    const ip = randomIp();
    for (let i = 0; i < 30; i++) expect((await postFrom(ip, '/api/crawl/join/link', { token: `nope${i}` })).status).toBe(410);
    expect((await postFrom(ip, '/api/crawl/join/link', { token: link.token })).status).toBe(429);
  });
});
