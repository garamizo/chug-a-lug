import { afterEach, expect, it, vi } from 'vitest';
const clock = vi.hoisted(() => ({ enabled: true, revision: 1 }));
vi.mock('$lib/sim/clock.svelte', () => ({ clientClock: clock }));
vi.mock('$lib/pb', () => ({ pb: { authStore: { token: 'test' } } }));
import { fetchAlerts, fetchNext } from '$lib/live/feed';
afterEach(() => { clock.revision = 1; vi.unstubAllGlobals(); });
it('uses no-store and refuses a response from before a clock revision', async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const pending = fetchAlerts(); clock.revision = 2;
  finish({ ok: true, json: async () => ({ revision: 1, alerts: [{ id: 'obsolete' }] }) });
  await expect(pending).rejects.toThrow('obsolete_feed');
  expect(fetcher).toHaveBeenCalledWith('/api/metra/alerts', expect.objectContaining({ cache: 'no-store' }));
});
it('refuses a feed from a newer server revision until the clock catches up', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 2, trips: [] }) }));
  await expect(fetchNext('CUS', 'LAGRANGE', '2026-12-26', new Date())).rejects.toThrow('obsolete_feed');
});
