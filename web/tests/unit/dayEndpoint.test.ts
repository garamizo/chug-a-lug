import { expect, it, vi } from 'vitest';
vi.mock('$lib/server/pb', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('$lib/server/sim/clock', async (orig) => ({
  ...(await orig<object>()),
  simulationClock: { readContext: vi.fn(async () => ({ enabled: false, eventNow: '2026-09-25T04:30:00.000Z', serverWallNow: '2026-09-25T04:30:00.000Z' })) }
}));
it('answers with the Chicago date of the server clock, not UTC', async () => {
  const { GET } = await import('../../src/routes/api/day/+server');
  const res = await GET({ request: new Request('http://x/api/day') } as never);
  expect(await res.json()).toEqual({ today: '2026-09-24', now: '2026-09-25T04:30:00.000Z' });
  expect(res.headers.get('cache-control')).toBe('no-store');
});
