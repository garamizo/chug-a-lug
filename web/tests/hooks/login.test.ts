import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, deleteUserByName, login, post } from './setup';

const names: string[] = [];
function name(prefix = 'Tester') {
  const value = `${prefix} ${Math.floor(Math.random() * 1e6)}`;
  names.push(value);
  return value;
}

// These tests require a disposable PocketBase started with CREW_PASSWORD and ADMIN_PASSWORD set.
describe('shared-password login hook and access rules', () => {
  afterAll(async () => { for (const n of names) await deleteUserByName(n); });

  it('rejects bad names and wrong passwords', async () => {
    for (const bad of ['', 'x', 'a'.repeat(33), 'name<script>', ' - leading dash', 42]) {
      expect((await post('/api/crawl/login', { name: bad, password: 'whatever' })).status).toBe(400);
    }
    expect((await login(name(), 'not-the-password')).status).toBe(401);
    expect((await login(name(), '')).status).toBe(401);
  });

  it('creates the identity on first login and reuses it case-insensitively', async () => {
    const n = name('Gui');
    const first = await login(`  ${n}  `);
    expect(first.status).toBe(200);
    const a = await first.json();
    expect(a.token).toBeTypeOf('string');
    expect(a.record).toMatchObject({ name: n, name_key: n.toLowerCase(), is_admin: false, verified: true });
    expect(a.record.password).toBeUndefined();

    const second = await login(n.toUpperCase());
    expect(second.status).toBe(200);
    const b = await second.json();
    expect(b.record.id).toBe(a.record.id);
    expect(b.record.name).toBe(n); // first-seen spelling is kept
  });

  it('grants admin with the admin password and keeps it on later crew logins', async () => {
    const n = name('Boss');
    const admin = await (await login(n, ADMIN_LOGIN_PASSWORD)).json();
    expect(admin.record.is_admin).toBe(true);
    const again = await (await login(n)).json();
    expect(again.record.id).toBe(admin.record.id);
    expect(again.record.is_admin).toBe(true);
  });

  it('lets users edit their own preferences but not identity or privileges', async () => {
    const n = name('Rider');
    const { token, record } = await (await login(n)).json();
    const other = await (await login(name('Other'))).json();
    const resource = `${PB}/api/collections/users/records/${record.id}`;
    const patch = (url: string, body: unknown) => fetch(url, {
      method: 'PATCH', headers: { Authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    expect((await patch(resource, { share_position: true, home_station: 'Elburn', left_early: true })).status).toBe(200);
    for (const body of [{ is_admin: true }, { name: 'Renamed' }, { name_key: 'renamed' }, { password: 'abcdefgh', passwordConfirm: 'abcdefgh' }]) {
      expect((await patch(resource, body)).status).toBe(404);
    }
    expect((await patch(`${PB}/api/collections/users/records/${other.record.id}`, { left_early: true })).status).toBe(404);
    expect((await fetch(`${PB}/api/collections/users/records`, { headers: { Authorization: token } })).status).toBe(200);
    expect((await fetch(resource)).status).toBe(404);
    expect((await post('/api/collections/users/records', { name: 'Sneaky', name_key: 'sneaky', password: 'abcdefgh', passwordConfirm: 'abcdefgh' }, token)).status).toBe(403);
    expect((await fetch(resource, { method: 'DELETE', headers: { Authorization: token } })).status).toBe(403);
    // password auth is disabled: the random stored password cannot be used
    expect((await post('/api/collections/users/auth-with-password', { identity: n, password: 'anything' })).status).toBeGreaterThanOrEqual(400);
  });

  it('rate limits login attempts per client', async () => {
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await login(name('Limit'), 'wrong')).status;
    expect(last).toBe(429);
  });
});
