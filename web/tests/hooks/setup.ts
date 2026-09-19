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
