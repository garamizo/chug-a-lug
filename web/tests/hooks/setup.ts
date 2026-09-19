export const PB = process.env.PB_URL ?? 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@chugalug.app';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'change-me-please';

export async function superuserToken(): Promise<string> {
  const response = await post('/api/collections/_superusers/auth-with-password', {
    identity: ADMIN_EMAIL, password: ADMIN_PASSWORD
  });
  if (!response.ok) throw new Error(`Superuser login failed: ${response.status}`);
  return (await response.json()).token;
}

async function findRecords(collection: string, phone: string, token: string) {
  const query = new URLSearchParams({ filter: `phone=${JSON.stringify(phone)}` });
  const response = await fetch(`${PB}/api/collections/${collection}/records?${query}`, {
    headers: { Authorization: token }
  });
  if (!response.ok) throw new Error(`Record lookup failed: ${response.status}`);
  return (await response.json()).items as Array<{ id: string }>;
}

export async function seedAllowlist(phone: string, name: string, isAdmin = false): Promise<void> {
  const token = await superuserToken();
  const existing = await findRecords('allowlist', phone, token);
  const response = await fetch(`${PB}/api/collections/allowlist/records${existing[0] ? '/' + existing[0].id : ''}`, {
    method: existing.length ? 'PATCH' : 'POST',
    headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify({ phone, name, is_admin: isAdmin })
  });
  if (!response.ok) throw new Error(`Allowlist seed failed: ${response.status}`);
}

export async function deleteUser(phone: string): Promise<void> {
  await deleteRecords('users', phone);
}

export async function deleteRecords(collection: string, phone: string): Promise<void> {
  const token = await superuserToken();
  for (const record of await findRecords(collection, phone, token)) {
    const response = await fetch(`${PB}/api/collections/${collection}/records/${record.id}`, {
      method: 'DELETE', headers: { Authorization: token }
    });
    if (!response.ok) throw new Error(`Record deletion failed: ${response.status}`);
  }
}

export function post(path: string, body: unknown, token?: string) {
  return fetch(`${PB}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body)
  });
}
