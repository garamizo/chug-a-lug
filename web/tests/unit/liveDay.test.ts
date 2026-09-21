import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '$lib/types';

const mocks = vi.hoisted(() => ({
  getList: vi.fn(), filter: vi.fn((raw: string, _params: unknown) => raw),
  callbacks: new Map<string, () => void>(), unsubs: [] as ReturnType<typeof vi.fn>[]
}));
vi.mock('$lib/pb', () => ({
  pb: { collection: () => ({ getList: mocks.getList }), filter: mocks.filter },
  subscribe: (name: string, _filter: string, callback: () => void) => {
    mocks.callbacks.set(name, callback);
    const unsub = vi.fn(); mocks.unsubs.push(unsub); return unsub;
  }
}));
vi.mock('$lib/live/feed', () => ({ fetchStatus: async () => ({ mode: 'schedule_only' }) }));
const { LiveDay } = await import('$lib/live/day.svelte');

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.callbacks.clear(); mocks.unsubs.length = 0;
  mocks.getList.mockResolvedValue({ items: [] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function startDay() {
  const day = new LiveDay();
  const reload = vi.spyOn(day, 'loadRoute').mockResolvedValue(undefined);
  for (const method of ['loadBulletins', 'loadTrains', 'loadDrinks', 'loadMedia', 'loadAlerts'] as const) {
    vi.spyOn(day, method).mockResolvedValue(undefined);
  }
  return { reload, stop: day.start() };
}

describe('live route refresh', () => {
  it('loads immediately, then coalesces collection bursts after 750 ms of quiet', async () => {
    const { reload, stop } = startDay();
    try {
      expect(reload).toHaveBeenCalledTimes(1);
      mocks.callbacks.get('itineraries')!();
      await vi.advanceTimersByTimeAsync(500);
      mocks.callbacks.get('stops')!();
      for (let i = 0; i < 100; i++) mocks.callbacks.get('legs')!();
      await vi.advanceTimersByTimeAsync(749);
      expect(reload).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(reload).toHaveBeenCalledTimes(2);
      mocks.callbacks.get('legs')!();
      await vi.advanceTimersByTimeAsync(750);
      expect(reload).toHaveBeenCalledTimes(3);
    } finally { stop(); }
  });

  it('cancels pending refreshes and ignores late callbacks after teardown', async () => {
    const { reload, stop } = startDay();
    mocks.callbacks.get('stops')!();
    stop();
    mocks.callbacks.get('legs')!();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(reload).toHaveBeenCalledTimes(1);
    for (const unsub of mocks.unsubs) expect(unsub).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('live anchor lookup', () => {
  it('scopes the newest admin check-in to the loaded itinerary', async () => {
    const day = new LiveDay();
    day.itinerary = { id: 'route' } as Itinerary;
    mocks.getList.mockResolvedValue({ items: [
      { stop: 'crew', at: 'later', expand: { user: { is_admin: false } } },
      { stop: 'a', at: 'now', expand: { user: { is_admin: true } } }
    ] });
    await day.loadAnchor();
    expect(mocks.filter).toHaveBeenCalledWith('kind = "at_stop" && stop.itinerary = {:id}', { id: 'route' });
    expect(mocks.getList).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort: '-at', expand: 'user' }));
    expect(day.anchor).toEqual({ stopId: 'a', at: 'now' });
  });

  it('clears the anchor without querying when no itinerary is loaded', async () => {
    const day = new LiveDay(); day.anchor = { stopId: 'old', at: 'yesterday' };
    await day.loadAnchor();
    expect(day.anchor).toBeNull();
    expect(mocks.getList).not.toHaveBeenCalled();
  });
});
