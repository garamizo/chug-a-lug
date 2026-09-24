import { expect, it, vi } from 'vitest';
const readContext = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/pb', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('$lib/server/sim/clock', async (orig) => ({
  ...(await orig<object>()),
  simulationClock: { readContext }
}));
it('answers with the Chicago date of the server clock, not UTC', async () => {
  readContext.mockResolvedValue({ enabled: false, eventNow: '2026-09-25T04:30:00.000Z', serverWallNow: '2026-09-25T04:30:00.000Z' });
  const { GET } = await import('../../src/routes/api/day/+server');
  const res = await GET({ request: new Request('http://x/api/day') } as never);
  expect(await res.json()).toEqual({ today: '2026-09-24', now: '2026-09-25T04:30:00.000Z', revision: null });
  expect(res.headers.get('cache-control')).toBe('no-store');
});
it('carries the simulation revision, so the client accepts it in the harness', async () => {
  readContext.mockResolvedValue({ enabled: true, revision: 7, eventNow: '2026-12-26T18:00:00.000Z', serverWallNow: '2026-09-24T18:00:00.000Z' });
  const { GET } = await import('../../src/routes/api/day/+server');
  const res = await GET({ request: new Request('http://x/api/day') } as never);
  expect(await res.json()).toMatchObject({ today: '2026-12-26', revision: 7 });
});
