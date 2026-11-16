import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PB, invite, superuserToken, truncate } from './setup';

const SECRET = process.env.INTERNAL_SECRET ?? '';
const act = (body: unknown, headers: Record<string, string> = { 'x-internal-secret': SECRET }) =>
  fetch(`${PB}/api/crawl/invite`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const su = async () => ({ Authorization: await superuserToken(), 'content-type': 'application/json' });
async function rows(collection: string, query = 'sort=created') {
  return (await (await fetch(`${PB}/api/collections/${collection}/records?${query}`, { headers: await su() })).json()).items as any[];
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const patchLink = async (id: string, body: unknown) => fetch(`${PB}/api/collections/join_links/records/${id}`, { method: 'PATCH', headers: await su(), body: JSON.stringify(body) });

describe('join links (spec §4.1)', () => {
  beforeEach(() => truncate('join_links'));

  it('create answers a url once and stores only the hash', async () => {
    const made = await invite(12, 7);
    expect(made.url).toMatch(/\/join#[A-Za-z0-9]{32}$/);
    const [row] = await rows('join_links');
    expect(row.token_hash).toBe(sha(made.token));
    expect(row.seats).toBe(12);
    expect(row.seats_left).toBe(12);
    expect(JSON.stringify(row)).not.toContain(made.token);
  });

  it('a new link revokes the old one', async () => {
    await invite(5);
    await invite(5);
    const all = await rows('join_links');
    expect(all.length).toBe(2);
    expect(all[0].revoked_at).toBeTruthy();
    expect(all[1].revoked_at).toBeFalsy();
    expect(await (await act({ action: 'status' })).json()).toMatchObject({ state: 'active', seats: 5, seats_left: 5 });
  });

  it('status reports none, expired, full and revoked', async () => {
    const state = async () => (await (await act({ action: 'status' })).json()).state;
    expect(await state()).toBe('none');
    await invite(5);
    const [row] = await rows('join_links');
    expect(await state()).toBe('active');
    await patchLink(row.id, { expires_at: '2020-01-01 00:00:00.000Z' });
    expect(await state()).toBe('expired');
    await patchLink(row.id, { expires_at: '2099-01-01 00:00:00.000Z', seats_left: 0 });
    expect(await state()).toBe('full');
    await patchLink(row.id, { seats_left: 5 });
    expect(await state()).toBe('active');
    expect(await (await act({ action: 'revoke' })).json()).toEqual({ revoked: true });
    expect(await state()).toBe('revoked');
    expect(await (await act({ action: 'revoke' })).json()).toEqual({ revoked: false });
  });

  it('refuses without the secret, with a wrong one, and through the tunnel', async () => {
    expect((await act({ action: 'status' }, {})).status).toBe(404);
    expect((await act({ action: 'status' }, { 'x-internal-secret': 'nope' })).status).toBe(404);
    expect((await act({ action: 'status' }, { 'x-internal-secret': SECRET, 'CF-Connecting-IP': '203.0.113.9' })).status).toBe(404);
  });

  it('rejects seats 0 and 51 and days 0 and 61', async () => {
    for (const body of [{ seats: 0, days: 14 }, { seats: 51, days: 14 }, { seats: 5, days: 0 }, { seats: 5, days: 61 }]) {
      expect((await act({ action: 'create', ...body })).status).toBe(400);
    }
    expect((await rows('join_links')).length).toBe(0);
  });

  it('logs link_created and link_revoked', async () => {
    await invite(3, 2);
    await act({ action: 'revoke' });
    const log = await rows('access_log', `filter=${encodeURIComponent('event = "link_created" || event = "link_revoked"')}&sort=-created&perPage=20`);
    const created = log.find((r) => r.event === 'link_created' && /^3 seats until \d{4}-\d{2}-\d{2}$/.test(r.detail));
    expect(created).toBeTruthy();
    expect(log.some((r) => r.event === 'link_revoked')).toBe(true);
  });
});
