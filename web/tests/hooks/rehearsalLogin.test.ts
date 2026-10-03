import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, CREW_PASSWORD, deleteUserByName, post } from './setup';

const names: string[] = [];
const name = (prefix: string) => { const v = `${prefix} ${Math.floor(Math.random() * 1e6)}`; names.push(v); return v; };
const login = (n: string, password = CREW_PASSWORD) => post('/api/crawl/login', { name: n, password });

describe.skipIf(process.env.SIM !== '1')('rehearsal login (SIM=1 only)', () => {
  afterAll(async () => { for (const n of names) await deleteUserByName(n); });

  it('creates the identity with a rehearsal email and reuses it case-insensitively', async () => {
    const n = name('Gui');
    const a = await (await login(`  ${n}  `)).json();
    expect(a.record).toMatchObject({ name: n, is_admin: false });
    const b = await (await login(n.toUpperCase())).json();
    expect(b.record.id).toBe(a.record.id);
  });

  it('never hands a Conductor name to the crew password', async () => {
    const n = name('Boss');
    expect((await (await login(n, ADMIN_LOGIN_PASSWORD)).json()).record.is_admin).toBe(true);
    const crew = await login(n);
    expect(crew.status).toBe(403);
    expect((await crew.json()).message).toContain('Conductor password');
  });

  it('rejects wrong passwords', async () => {
    expect((await login(name('Rider'), 'nope')).status).toBe(401);
  });
});
