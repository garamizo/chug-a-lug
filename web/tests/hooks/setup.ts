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
