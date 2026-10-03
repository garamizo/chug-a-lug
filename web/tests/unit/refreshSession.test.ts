import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { ClientResponseError } from 'pocketbase';
import { pb, refreshSession } from '../../src/lib/pb';

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
/** A token issued `ageS` seconds ago with the 90-day lifetime; `iat` only when asked for. */
const token = (ageS: number, extra: Record<string, unknown> = {}) =>
  'h.' + btoa(JSON.stringify({ exp: nowS() - ageS + 90 * DAY, refreshable: true, ...extra })) + '.' + Math.random().toString(36).slice(2);
/** What the SDK throws for a PocketBase JSON error, and for a non-JSON body (an edge challenge page). */
const pbRefusal = (status: number) => new ClientResponseError({ status, response: { status, message: 'Your seat was taken away. Ask the Conductor.', data: {} } });
const pageRefusal = (status: number) => new ClientResponseError({ status, response: {} });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; };

let send: MockInstance<(path: string, options?: unknown) => Promise<unknown>>;
beforeEach(() => { send = vi.spyOn(pb, 'send') as never; });
afterEach(() => { vi.restoreAllMocks(); pb.authStore.clear(); });
const calls = () => send.mock.calls.map((c) => c[0]);

it('keeps the session with no signal, and ends it only on a PocketBase 401/403', async () => {
  pb.authStore.save(token(3600), { id: 'u' } as never);
  send.mockRejectedValueOnce(new ClientResponseError({ status: 0 }));
  expect(await refreshSession()).toBe('offline');
  send.mockRejectedValueOnce(pageRefusal(403)); // Cloudflare's challenge page is not PocketBase saying no
  expect(await refreshSession()).toBe('offline');
  send.mockRejectedValueOnce(pageRefusal(401));
  expect(await refreshSession()).toBe('offline');
  send.mockRejectedValueOnce(pbRefusal(403));
  expect(await refreshSession()).toBe('signed_out');
  send.mockRejectedValueOnce(pbRefusal(401));
  expect(await refreshSession()).toBe('signed_out');
});

it("applies /api/crawl/me's record with the same token, so a promotion or rename shows at once", async () => {
  const t = token(3600);
  pb.authStore.save(t, { id: 'u', name: 'Old', is_admin: false } as never);
  send.mockResolvedValueOnce({ record: { id: 'u', name: 'New', is_admin: true } });
  expect(await refreshSession()).toBe('ok');
  expect(pb.authStore.token).toBe(t);
  expect(pb.authStore.record).toMatchObject({ name: 'New', is_admin: true });
  expect(calls()).toEqual(['/api/crawl/me']); // a token an hour old is not renewed
});

it('renews a token issued more than a day ago, judged by iat or else by exp minus 90 days', async () => {
  for (const [t, renews] of [
    [token(2 * DAY), true], [token(3600), false],
    [token(0, { iat: nowS() - 2 * DAY }), true], [token(0, { iat: nowS() - 3600 }), false],
    [token(10 * DAY, { refreshable: false }), false] // an impersonated test session cannot be refreshed
  ] as const) {
    send.mockReset();
    pb.authStore.save(t, { id: 'u' } as never);
    const renewed = token(0);
    send.mockResolvedValueOnce({ record: { id: 'u' } }).mockResolvedValueOnce({ token: renewed, record: { id: 'u', name: 'Renewed' } });
    expect(await refreshSession()).toBe('ok');
    expect(calls(), t).toEqual(renews ? ['/api/crawl/me', '/api/collections/users/auth-refresh'] : ['/api/crawl/me']);
    if (renews) {
      expect(send.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { Authorization: t } });
      expect(pb.authStore.token).toBe(renewed);
    } else expect(pb.authStore.token).toBe(t);
  }
});

it('a failed renewal never signs anyone out', async () => {
  const t = token(30 * DAY);
  pb.authStore.save(t, { id: 'u' } as never);
  send.mockResolvedValueOnce({ record: { id: 'u' } }).mockRejectedValueOnce(pbRefusal(401));
  expect(await refreshSession()).toBe('ok');
  expect(pb.authStore.token).toBe(t);
});

it('a renewal that resolves after logout or a switch of account changes nothing', async () => {
  for (const after of ['logout', 'switch'] as const) {
    send.mockReset();
    const t = token(2 * DAY);
    pb.authStore.save(t, { id: 'u' } as never);
    const renewal = deferred<unknown>();
    send.mockResolvedValueOnce({ record: { id: 'u' } }).mockReturnValueOnce(renewal.promise as never);
    const done = refreshSession();
    await vi.waitFor(() => expect(calls()).toHaveLength(2));
    const other = token(0);
    if (after === 'logout') pb.authStore.clear(); else pb.authStore.save(other, { id: 'someone-else' } as never);
    renewal.resolve({ token: token(0), record: { id: 'u' } });
    expect(await done).toBe('ok');
    if (after === 'logout') { expect(pb.authStore.token).toBe(''); expect(pb.authStore.record).toBeNull(); }
    else { expect(pb.authStore.token).toBe(other); expect(pb.authStore.record).toMatchObject({ id: 'someone-else' }); }
  }
});

it('a /me answer that arrives after logout neither restores the record nor signs out the next session', async () => {
  pb.authStore.save(token(3600), { id: 'u' } as never);
  const me = deferred<unknown>();
  send.mockReturnValueOnce(me.promise as never);
  const done = refreshSession();
  pb.authStore.clear();
  me.resolve({ record: { id: 'u', name: 'Ghost' } });
  expect(await done).toBe('ok');
  expect(pb.authStore.record).toBeNull();
  // And a refusal for a session already replaced is not a reason to end the new one.
  pb.authStore.save(token(3600), { id: 'u' } as never);
  let reject!: (e: unknown) => void;
  send.mockReturnValueOnce(new Promise((_, r) => (reject = r)) as never);
  const second = refreshSession();
  const next = token(60);
  pb.authStore.save(next, { id: 'u' } as never);
  reject(pbRefusal(401));
  expect(await second).toBe('ok');
  expect(pb.authStore.token).toBe(next);
});
