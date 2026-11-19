import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, clearMails, get, loginToken, mails, post, postFrom, randomIp, setRole, superuserToken, mailBarrier, waitFor } from './setup';

const emailOf = (key: string) => `${Buffer.from(key).toString('hex')}@test.invalid`;
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function logRows(filter: string) {
  const q = new URLSearchParams({ filter, sort: '-created' });
  return (await (await fetch(`${PB}/api/collections/access_log/records?${q}`, { headers: await su() })).json()).items as any[];
}

const uid = () => Math.floor(Math.random() * 1e6);
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

describe('sign-in and the guards', () => {
  beforeEach(clearMails);
  const SEED = 'seed-test-password-1';
  // Each try comes from its own address: refusals are logged once per IP per 15 minutes.
  const signIn = (email: string) => postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity: email, password: SEED });

  it('a member signs in with email and password, and it is logged', async () => {
    const name = `Signer ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const auth = await signIn(emailOf(name.toLowerCase()));
    expect(auth.status).toBe(200);
    expect((await auth.json()).record.id).toBe(id);
    expect((await logRows(`user = "${id}" && event = "signed_in" && method = "password"`)).length).toBe(1);
  });

  it('email codes and Google are switched off', async () => {
    const methods = await (await get('/api/collections/users/auth-methods')).json();
    expect(methods.password.enabled).toBe(true);
    expect(methods.otp.enabled).toBe(false);
    expect(methods.oauth2.enabled).toBe(false);
    expect(methods.oauth2.providers).toEqual([]);
  });

  it('a put-off member cannot sign in or refresh, and a refresh never logs a sign-in', async () => {
    // A real password session: impersonation tokens (loginToken) are not refreshable at all.
    const name = `Putoff ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    const { token } = await (await signIn(email)).json();
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(200);
    expect((await logRows(`user = "${id}" && event = "signed_in"`)).length).toBe(1); // the sign-in only
    await setRole(id, 'put_off');
    expect((await post('/api/collections/users/auth-refresh', {}, token)).status).toBe(401); // putting off now ends the session
    expect((await signIn(email)).status).toBe(403);
  });

  it('a password sign-in is guarded like every other method', async () => {
    const name = `Passworded ${Math.floor(Math.random() * 1e6)}`;
    const { id } = await loginToken(name);
    const email = emailOf(name.toLowerCase());
    await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: await su(),
      body: JSON.stringify({ password: 'recovery-password-1', passwordConfirm: 'recovery-password-1', role: 'put_off' }) });
    // Refusals are logged once per IP per 15 minutes, so this test brings its own address.
    expect((await postFrom(randomIp(), '/api/collections/users/auth-with-password', { identity: email, password: 'recovery-password-1' })).status).toBe(403);
    expect((await logRows(`user = "${id}" && event = "sign_in_refused" && method = "password" && detail = "put_off"`)).length).toBe(1);
  });

  it('crew cannot change their own email through PocketBase\'s email-change flow', async () => {
    const { token } = await loginToken(`Mover ${Math.floor(Math.random() * 1e6)}`);
    const newEmail = `moved${Math.floor(Math.random() * 1e6)}@test.invalid`;
    const res = await post('/api/collections/users/request-email-change', { newEmail }, token);
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe('Ask the Conductor to change your email.');
    await mailBarrier();
    expect(await mails(newEmail)).toEqual([]);
  });

  it('a put-off that lands while the person saves their own record is never undone', async () => {
    const boss = await loginToken(`Guard ${Math.floor(Math.random() * 1e6)}`, ADMIN_LOGIN_PASSWORD);
    for (let round = 0; round < 3; round++) {
      const rider = await loginToken(`Racer ${Math.floor(Math.random() * 1e6)}`);
      const save = (i: number) => fetch(`${PB}/api/collections/users/records/${rider.id}`, { method: 'PATCH',
        headers: { Authorization: rider.token, 'content-type': 'application/json' }, body: JSON.stringify({ share_position: i % 2 === 0 }) });
      const early = Array.from({ length: 12 }, (_, i) => save(i));
      const off = post(`/api/crawl/users/${rider.id}/role`, { role: 'put_off' }, boss.token);
      const late = Array.from({ length: 12 }, (_, i) => save(i));
      expect((await off).status).toBe(200);
      await Promise.all([...early, ...late]);
      const row = await (await fetch(`${PB}/api/collections/users/records/${rider.id}`, { headers: await su() })).json();
      expect(row.role, `round ${round}`).toBe('put_off');
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
    for (const body of [{ is_admin: true }, { role: 'crew' }, { role: 'trainspotter' }, { email: 'x@test.invalid' }, { last_seen: '2020-01-01 00:00:00.000Z' }, { name_key: 'x' }]) {
      const res = await fetch(`${PB}/api/collections/users/records/${id}`, { method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(404);
    }
  });
});

describe('put off, manifest and names (spec §2.9–2.11)', () => {
  const setRoleAs = (id: string, role: unknown, token: string) => post(`/api/crawl/users/${id}/role`, { role }, token);

  it('the role endpoint is the Conductor\'s, never on themselves or another admin', async () => {
    const boss = await loginToken(`Chief ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const other = await loginToken(`Deputy ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Rider ${uid()}`);
    expect((await setRoleAs(boss.id, 'put_off', rider.token)).status).toBe(403);
    expect((await setRoleAs(rider.id, 'trainspotter', rider.token)).status).toBe(403);
    expect((await setRoleAs(boss.id, 'trainspotter', boss.token)).status).toBe(400);
    expect((await setRoleAs(other.id, 'put_off', boss.token)).status).toBe(400);
    expect((await setRoleAs(rider.id, 'conductor', boss.token)).status).toBe(400);
    expect((await setRoleAs(rider.id, undefined, boss.token)).status).toBe(400);
    // An array would pass a key lookup (['put_off'] coerces to 'put_off'): only a string is a role.
    expect((await setRoleAs(rider.id, ['put_off'], boss.token)).status).toBe(400);
    expect((await setRoleAs('nosuchuser0000', 'crew', boss.token)).status).toBe(404);
    // The Manifest's old put-off / let-back-on routes are gone: the role endpoint is the only way.
    for (const old of ['put-off', 'let-back-on']) expect((await post(`/api/crawl/users/${rider.id}/${old}`, {}, boss.token)).status, old).toBe(404);
    // Nothing above changed anyone or wrote a row.
    expect((await get('/api/crawl/me', rider.token)).status).toBe(200);
    expect((await get('/api/crawl/me', other.token)).status).toBe(200);
    expect(await logRows(`event = "role_changed" && (user = "${rider.id}" || user = "${other.id}" || user = "${boss.id}")`)).toEqual([]);
  });

  it('putting someone off kills their token; Crew lets them back on', async () => {
    const boss = await loginToken(`Chief ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Rider ${uid()}`);
    expect((await get('/api/crawl/me', rider.token)).status).toBe(200);
    const off = await setRoleAs(rider.id, 'put_off', boss.token);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ role: 'put_off' });
    expect((await get('/api/crawl/me', rider.token)).status).toBe(401);
    // A list rule filters rather than rejects (200, zero rows), so prove the token is dead where PocketBase must reject it.
    expect((await fetch(`${PB}/api/collections/users/auth-refresh`, { method: 'POST', headers: { Authorization: rider.token } })).status).toBe(401);
    expect((await (await fetch(`${PB}/api/collections/users/records`, { headers: { Authorization: rider.token } })).json()).items).toEqual([]);
    const on = await setRoleAs(rider.id, 'crew', boss.token);
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ role: 'crew' });
    const [putOff] = await logRows(`event = "put_off" && user = "${rider.id}"`);
    const [backOn] = await logRows(`event = "let_back_on" && user = "${rider.id}"`);
    expect(putOff).toMatchObject({ actor: boss.id, detail: 'Crew → Put off' });
    expect(backOn).toMatchObject({ actor: boss.id, detail: 'Put off → Crew' });
    expect(Date.parse(putOff.created)).toBeLessThanOrEqual(Date.parse(backOn.created));
    // The same role again changes nothing and logs nothing.
    expect(await (await setRoleAs(rider.id, 'crew', boss.token)).json()).toEqual({ role: 'crew' });
    expect((await logRows(`user = "${rider.id}" && (event = "let_back_on" || event = "role_changed")`)).length).toBe(1);
  });

  it('crew ↔ trainspotter is logged as role_changed with from → to', async () => {
    const boss = await loginToken(`Chief ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Spotter ${uid()}`);
    const res = await setRoleAs(rider.id, 'trainspotter', boss.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'trainspotter' });
    expect((await get('/api/crawl/me', rider.token)).status).toBe(200);   // a Trainspotter keeps their seat
    expect((await setRoleAs(rider.id, 'crew', boss.token)).status).toBe(200);
    const rows = await logRows(`event = "role_changed" && user = "${rider.id}"`);
    expect(rows.map((r) => r.detail).sort()).toEqual(['Crew → Trainspotter', 'Trainspotter → Crew']);
    for (const r of rows) expect(r.actor).toBe(boss.id);
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
      expect((await setRoleAs(rider.id, 'put_off', boss.token)).status).toBe(200);
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

  it('the manifest carries role', async () => {
    const boss = await loginToken(`Lister ${uid()}`, ADMIN_LOGIN_PASSWORD);
    const rider = await loginToken(`Watcher ${uid()}`);
    await setRole(rider.id, 'trainspotter');
    const m = await (await fetch(`${PB}/api/crawl/manifest`, { headers: { Authorization: boss.token } })).json();
    const row = m.people.find((p: { id: string }) => p.id === rider.id);
    expect(row.role).toBe('trainspotter');
    expect(row).not.toHaveProperty('blocked');
  });

  it('put-off people stay readable so their posts keep a name', async () => {
    const gone = await loginToken(`Gone ${uid()}`);
    const reader = await loginToken(`Reader ${uid()}`);
    await setRole(gone.id, 'put_off');
    const q = new URLSearchParams({ filter: `id = "${gone.id}"` });
    const rows = (await (await fetch(`${PB}/api/collections/users/records?${q}`, { headers: { Authorization: reader.token } })).json()).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: gone.id, name: expect.stringMatching(/^Gone \d+$/), role: 'put_off' });
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

  it('a superuser rename is saved and logged without an actor; a superuser put-off ends sessions', async () => {
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
    expect((await patch({ role: 'put_off' })).status).toBe(200);
    expect((await get('/api/crawl/me', u.token)).status).toBe(401);
  });
});
