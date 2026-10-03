import { describe, expect, it } from 'vitest';
import { PB, post, superuserToken } from './setup';

const viaTunnel = { 'CF-Connecting-IP': '203.0.113.9' };
const creds = JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL ?? 'tests@chugalug.invalid', password: process.env.PB_ADMIN_PASSWORD ?? 'local-test-password-only' });

describe('the tunnel cannot reach the superuser surface (spec §3)', () => {
  it('blocks /_/ and superuser auth by name and by id when CF-Connecting-IP is present', async () => {
    const token = await superuserToken();
    const id = (await (await fetch(`${PB}/api/collections/_superusers`, { headers: { Authorization: token } })).json()).id;
    expect((await fetch(`${PB}/_/`, { headers: viaTunnel })).status).toBe(404);
    for (const c of ['_superusers', id]) {
      const res = await fetch(`${PB}/api/collections/${c}/auth-with-password`, { method: 'POST', headers: { ...viaTunnel, 'content-type': 'application/json' }, body: creds });
      expect(res.status, c).toBe(404);
    }
  });

  it('still serves both without the header (the box and the web container)', async () => {
    expect((await fetch(`${PB}/_/`)).status).toBe(200);
    expect((await post('/api/collections/_superusers/auth-with-password', JSON.parse(creds))).status).toBe(200);
  });

  it('has no password login in production mode', async () => {
    expect((await post('/api/crawl/login', { name: 'Anyone', password: 'x' })).status).toBe(404);
  });
});
