// requireUser caches who a token belongs to for a minute, but admin-gated and write endpoints ask
// PocketBase every time: a put-off or demoted Conductor loses them at once (Codex C2).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Every other setting reads as empty; nothing here touches the data directory.
vi.mock('$lib/server/env', () => ({ serverEnv: new Proxy({ pbUrl: 'http://pb.test', dataDir: '/nonexistent/chugalug-unit' } as Record<string, unknown>,
  { get: (t, k) => (typeof k === 'string' && k in t ? t[k] : '') }) }));
vi.mock('$lib/server/sim/clock', () => ({ simulationClock: { readContext: vi.fn(), change: vi.fn(async () => ({})) } }));
vi.mock('$lib/server/places/attach', () => ({ attachPlace: vi.fn(async () => ({ ok: true })) }));
vi.mock('$lib/server/places/nearby', () => ({ nearbyForStation: vi.fn(async () => ({ venues: [] })) }));

const { requireUser } = await import('../../src/lib/server/pb');
const sim = await import('../../src/routes/api/sim/clock/+server');
const attach = await import('../../src/routes/api/places/attach/+server');
const nearby = await import('../../src/routes/api/places/nearby/+server');
const commit = await import('../../src/routes/api/plan/commit/+server');

const me = { id: 'boss', is_admin: true };
let answer: { status: number; body: unknown };
const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer.body), { status: answer.status }));
const status = async (run: () => Response | Promise<Response>) => { try { return (await run()).status; } catch (e) { return (e as { status: number }).status; } };
let n = 0;
const request = (token: string, method = 'GET', body?: unknown) =>
  new Request('http://web.test/x', { method, headers: { authorization: token }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  answer = { status: 200, body: { record: me } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('caches an identity for a minute, and a fresh check always asks PocketBase', async () => {
  vi.useFakeTimers({ now: new Date('2026-12-26T18:00:00Z'), toFake: ['Date'] });
  const token = `token-${++n}`;
  expect(await requireUser(request(token))).toEqual(me);
  answer = { status: 403, body: { message: 'Your seat was taken away. Ask the Conductor.' } };
  expect(await requireUser(request(token))).toEqual(me); // still cached
  await expect(requireUser(request(token), { fresh: true })).rejects.toMatchObject({ status: 401 });
  // A refusal also clears the cache: the next ordinary check asks again.
  await expect(requireUser(request(token))).rejects.toMatchObject({ status: 401 });
  const other = `token-${++n}`;
  answer = { status: 200, body: { record: me } };
  await requireUser(request(other));
  answer = { status: 403, body: { message: 'gone' } };
  vi.setSystemTime(new Date('2026-12-26T18:01:01Z'));
  await expect(requireUser(request(other))).rejects.toMatchObject({ status: 401 }); // past the 60 s TTL
});

it('every admin-gated or write endpoint answers 401 right after a put-off, even with a cached identity', async () => {
  const token = `token-${++n}`;
  await requireUser(request(token)); // cached as a Conductor, e.g. by an ordinary read a moment ago
  answer = { status: 403, body: { message: 'Your seat was taken away. Ask the Conductor.' } };
  fetchMock.mockClear();
  // A plain read still uses the minute-long cache...
  expect(await status(() => nearby.GET({ request: request(token), url: new URL('http://web.test/api/places/nearby?station=CUS') } as never))).toBe(200);
  expect(fetchMock).not.toHaveBeenCalled();
  // ...but nothing that changes data or needs the Conductor does.
  expect(await status(() => sim.POST({ request: request(token, 'POST', { action: 'pause' }) } as never))).toBe(401);
  expect(await status(() => attach.POST({ request: request(token, 'POST', { stopId: 'stopstopstop001' }) } as never))).toBe(401);
  expect(await status(() => commit.POST({ request: request(token, 'POST', {}) } as never))).toBe(401);
  expect(await status(() => nearby.GET({ request: request(token), url: new URL('http://web.test/api/places/nearby?station=CUS&refresh=1') } as never))).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
