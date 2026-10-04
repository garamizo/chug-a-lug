if (!process.env.PB_URL) throw new Error('PB_URL is unset: run the hooks through scripts/test-hooks.sh, never against the live stack');
export const PB = process.env.PB_URL;
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@chugalug.app';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'change-me-please';
export const CREW_PASSWORD = process.env.CREW_PASSWORD ?? 'crew-test-password';
export const ADMIN_LOGIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin-test-password';

export function post(path: string, body: unknown, token?: string) {
  return fetch(`${PB}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body)
  });
}

let superuser: Promise<string> | undefined;
/** One superuser login per test file (vitest isolates files): each login is a bcrypt check. */
export function superuserToken(): Promise<string> {
  superuser ??= (async () => {
    const response = await post('/api/collections/_superusers/auth-with-password', { identity: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (!response.ok) throw new Error(`Superuser login failed: ${response.status}`);
    return (await response.json()).token as string;
  })();
  superuser.catch(() => { superuser = undefined; });
  return superuser;
}

export async function deleteUserByName(name: string): Promise<void> {
  const token = await superuserToken();
  const query = new URLSearchParams({ filter: `name_key=${JSON.stringify(name.toLowerCase())}` });
  const list = await fetch(`${PB}/api/collections/users/records?${query}`, { headers: { Authorization: token } });
  if (!list.ok) throw new Error(`User lookup failed: ${list.status}`);
  for (const record of (await list.json()).items as Array<{ id: string }>) {
    const response = await fetch(`${PB}/api/collections/users/records/${record.id}`, {
      method: 'DELETE', headers: { Authorization: token }
    });
    if (!response.ok) throw new Error(`User deletion failed: ${response.status}`);
  }
}

const hexEmail = (key: string) => `${Buffer.from(key).toString('hex')}@test.invalid`;

/** A session for `name`, created on first use: superuser find-or-create, then impersonation. */
export async function loginToken(name: string, password: string = CREW_PASSWORD): Promise<{ token: string; id: string }> {
  const su = await superuserToken();
  const display = name.trim().replace(/\s+/g, ' '), key = display.toLowerCase();
  const admin = password === ADMIN_LOGIN_PASSWORD;
  const query = new URLSearchParams({ filter: `name_key=${JSON.stringify(key)}` });
  const found = await (await fetch(`${PB}/api/collections/users/records?${query}`, { headers: { Authorization: su } })).json();
  let user = found.items?.[0];
  if (!user) {
    const create = await fetch(`${PB}/api/collections/users/records`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: su },
      body: JSON.stringify({ name: display, name_key: key, email: hexEmail(key), verified: true, is_admin: admin,
        password: 'seed-test-password-1', passwordConfirm: 'seed-test-password-1' })
    });
    if (!create.ok) throw new Error(`Seed user failed: ${create.status} ${await create.text()}`);
    user = await create.json();
  } else if (admin && !user.is_admin) {
    await fetch(`${PB}/api/collections/users/records/${user.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: su }, body: JSON.stringify({ is_admin: true }) });
  }
  // Explicit and long: some suites move the clock months ahead. These tokens are not refreshable.
  const impersonate = await fetch(`${PB}/api/collections/users/impersonate/${user.id}`, {
    method: 'POST', headers: { Authorization: su, 'content-type': 'application/json' }, body: JSON.stringify({ duration: 400 * 86400 }) });
  if (!impersonate.ok) throw new Error(`Impersonate failed: ${impersonate.status}`);
  return { token: (await impersonate.json()).token, id: user.id };
}

export function get(path: string, token?: string) {
  return fetch(`${PB}${path}`, { headers: token ? { Authorization: token } : {} });
}

export function patch(path: string, body: unknown, token?: string) {
  return fetch(`${PB}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body)
  });
}

export function del(path: string, token?: string) {
  return fetch(`${PB}${path}`, { method: 'DELETE', headers: token ? { Authorization: token } : {} });
}

/** Deletes every record of a collection as superuser (test isolation). */
export async function truncate(collection: string): Promise<void> {
  const token = await superuserToken();
  const list = await fetch(`${PB}/api/collections/${collection}/records?perPage=500&fields=id`, { headers: { Authorization: token } });
  if (!list.ok) throw new Error(`List ${collection} failed: ${list.status}`);
  await Promise.all(((await list.json()).items as Array<{ id: string }>).map((record) =>
    fetch(`${PB}/api/collections/${collection}/records/${record.id}`, { method: 'DELETE', headers: { Authorization: token } })));
}

export const MAIL = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:12526';
export type Mail = { to: string[]; subject: string; text: string; html: string };
export async function mails(to?: string): Promise<Mail[]> {
  const all = (await (await fetch(`${MAIL}/messages`)).json()) as Mail[];
  return to ? all.filter((m) => m.to.includes(to.toLowerCase())) : all;
}
export async function clearMails(): Promise<void> { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
export async function mailMode(mode: 'ok' | 'fail'): Promise<void> {
  await fetch(`${MAIL}/mode`, { method: 'POST', body: JSON.stringify({ mode }) });
}
/** Polls `probe` every 25 ms for up to 5 s. */
async function poll<T>(probe: () => Promise<T | undefined>, what: string): Promise<T> {
  const until = Date.now() + 5000;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(what);
    await new Promise((r) => setTimeout(r, 25));
  }
}
/** The last 6-digit code mailed to `to`, polling briefly because PocketBase sends OTP mail asynchronously. */
export const codeFor = (to: string): Promise<string> => poll(async () =>
  (await mails(to)).map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1), `No code mailed to ${to}`);
/** The last password-reset link mailed to `to` (text or HTML part), polling: PocketBase mails after replying. */
export const resetLinkFor = (to: string): Promise<{ url: string; token: string }> => poll(async () => {
  const hit = (await mails(to)).map((m) => /(https?:\/\/[^\s"<]+\/reset-password#([\w.-]+))/.exec(`${m.text}\n${m.html}`)).filter(Boolean).at(-1);
  return hit ? { url: hit[1], token: hit[2] } : undefined;
}, `No reset link mailed to ${to}`);
/** A fresh documentation-range IP, so each test owns its own rate-limit buckets. */
export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
/** POST as if through the tunnel from `ip`; PocketBase trusts CF-Connecting-IP once Task 2's migration runs. */
export function postFrom(ip: string, path: string, body: unknown, token?: string) {
  return fetch(`${PB}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body)
  });
}
/** Schedules a registered cron job now (superuser API). It returns before the job finishes: follow with waitFor. */
export async function runCron(id: string): Promise<void> {
  const res = await fetch(`${PB}/api/crons/${id}`, { method: 'POST', headers: { Authorization: await superuserToken() } });
  if (!res.ok) throw new Error(`Cron ${id} failed: ${res.status}`);
}
/** Polls until `probe` returns something truthy, or fails after `ms`. */
export async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
let tokens = 0;
/** A Turnstile token the fake accepts exactly once. */
export const turnstileToken = () => `ok-${process.pid}-${++tokens}-${Math.random().toString(36).slice(2)}`;
/** A code the fake OIDC provider exchanges for this identity. */
export const oidcCode = (identity: { sub: string; email: string; email_verified?: boolean; name?: string }) =>
  Buffer.from(JSON.stringify({ email_verified: true, name: 'Fake Person', ...identity })).toString('base64url');
