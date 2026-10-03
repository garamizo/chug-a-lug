export const PB = process.env.PB_URL ?? 'http://127.0.0.1:8090';
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

export const login = (name: string, password: string = CREW_PASSWORD) => post('/api/crawl/login', { name, password });

export async function superuserToken(): Promise<string> {
  const response = await post('/api/collections/_superusers/auth-with-password', {
    identity: ADMIN_EMAIL, password: ADMIN_PASSWORD
  });
  if (!response.ok) throw new Error(`Superuser login failed: ${response.status}`);
  return (await response.json()).token;
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

// Hook test files share one PocketBase and one client IP (see login.test.ts's rate-limit test,
// which intentionally exhausts the shared 20-per-15-min login budget). If that file's tests run
// before this one's setup, /api/crawl/login can 429 here through no fault of the caller; fall
// back to creating the identity directly and minting a token via impersonation, which does not
// touch the login rate limiter.
async function seedUserToken(name: string, opts: { admin?: boolean } = {}): Promise<{ token: string; id: string }> {
  const token = await superuserToken();
  const create = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({
      name, name_key: name.trim().toLowerCase(),
      password: 'seed-test-password-1', passwordConfirm: 'seed-test-password-1',
      verified: true, is_admin: !!opts.admin
    })
  });
  if (!create.ok) throw new Error(`Seed user failed: ${create.status}`);
  const record = await create.json();
  const impersonate = await fetch(`${PB}/api/collections/users/impersonate/${record.id}`, {
    method: 'POST', headers: { Authorization: token }
  });
  if (!impersonate.ok) throw new Error(`Impersonate failed: ${impersonate.status}`);
  return { token: (await impersonate.json()).token, id: record.id };
}

export async function loginToken(name: string, password: string = CREW_PASSWORD): Promise<{ token: string; id: string }> {
  const response = await login(name, password);
  if (response.status === 429) return seedUserToken(name, { admin: password === ADMIN_LOGIN_PASSWORD });
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  const json = await response.json();
  return { token: json.token, id: json.record.id };
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
  const list = await fetch(`${PB}/api/collections/${collection}/records?perPage=500`, { headers: { Authorization: token } });
  if (!list.ok) throw new Error(`List ${collection} failed: ${list.status}`);
  for (const record of (await list.json()).items as Array<{ id: string }>) {
    await fetch(`${PB}/api/collections/${collection}/records/${record.id}`, { method: 'DELETE', headers: { Authorization: token } });
  }
}

export const MAIL = process.env.MAIL_SINK_URL ?? 'http://127.0.0.1:12526';
export type Mail = { to: string[]; subject: string; text: string };
export async function mails(to?: string): Promise<Mail[]> {
  const all = (await (await fetch(`${MAIL}/messages`)).json()) as Mail[];
  return to ? all.filter((m) => m.to.includes(to.toLowerCase())) : all;
}
export async function clearMails(): Promise<void> { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
export async function mailMode(mode: 'ok' | 'fail'): Promise<void> {
  await fetch(`${MAIL}/mode`, { method: 'POST', body: JSON.stringify({ mode }) });
}
/** The last 6-digit code mailed to `to`, polling briefly because PocketBase sends OTP mail asynchronously. */
export async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = (await mails(to)).map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No code mailed to ${to}`);
}
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
    await new Promise((r) => setTimeout(r, 100));
  }
}
let tokens = 0;
/** A Turnstile token the fake accepts exactly once. */
export const turnstileToken = () => `ok-${process.pid}-${++tokens}-${Math.random().toString(36).slice(2)}`;
/** A code the fake OIDC provider exchanges for this identity. */
export const oidcCode = (identity: { sub: string; email: string; email_verified?: boolean; name?: string }) =>
  Buffer.from(JSON.stringify({ email_verified: true, name: 'Fake Person', ...identity })).toString('base64url');
