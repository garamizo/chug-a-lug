import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '$lib/types';

const mocks = vi.hoisted(() => ({
  getList: vi.fn(), getFullList: vi.fn(), filter: vi.fn((raw: string, _params: unknown) => raw),
  callbacks: new Map<string, () => void>(), unsubs: [] as ReturnType<typeof vi.fn>[]
}));
vi.mock('$lib/pb', () => ({
  pb: { collection: () => ({ getList: mocks.getList, getFullList: mocks.getFullList }), filter: mocks.filter },
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
  for (const method of ['loadBulletins', 'loadTrains', 'loadFeed', 'loadAlerts'] as const) {
    vi.spyOn(day, method).mockResolvedValue(undefined);
  }
  return { day, reload, stop: day.start() };
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

  it('recovers missed Bulletins on the next route poll without a realtime event', async () => {
    const { day, reload, stop } = startDay();
    try {
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(day.loadBulletins).mockClear();
      let finish!: () => void;
      reload.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(day.loadBulletins).not.toHaveBeenCalled();
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(day.loadBulletins).toHaveBeenCalledOnce();
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
    expect(mocks.getList).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort: '-at,-action_order', expand: 'user' }));
    expect(day.anchor).toEqual({ stopId: 'a', at: 'now' });
  });

  it('clears the anchor without querying when no itinerary is loaded', async () => {
    const day = new LiveDay(); day.anchor = { stopId: 'old', at: 'yesterday' };
    await day.loadAnchor();
    expect(day.anchor).toBeNull();
    expect(mocks.getList).not.toHaveBeenCalled();
  });
});

it('requests paused anchors in server action order', async () => {
  const day = new LiveDay();
  mocks.getList.mockResolvedValue({ items: [
    { stop: 'newest', at: '2026-12-26T18:00:00Z', action_order: 2, expand: { user: { is_admin: true } } },
    { stop: 'older', at: '2026-12-26T18:00:00Z', action_order: 1, expand: { user: { is_admin: true } } }
  ] });
  await day.loadAnchor('itinerary');
  expect(mocks.getList).toHaveBeenCalledWith(1, 20, expect.objectContaining({ sort: '-at,-action_order' }));
  expect(day.anchor?.stopId).toBe('newest');
});

it('does not let an earlier anchor query overwrite a newer correction', async () => {
  const day = new LiveDay();
  let finish!: (value: unknown) => void;
  mocks.getList.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ items: [{ stop: 'new', at: 'now', expand: { user: { is_admin: true } } }] });
  const older = day.loadAnchor('route'); await day.loadAnchor('route');
  finish({ items: [] }); await older; expect(day.anchor?.stopId).toBe('new');
});

describe('live feed', () => {
  it('loads the whole route’s drinks, media, messages and reactions, and derives the current stop’s rows', async () => {
    const day = new LiveDay();
    day.itinerary = { id: 'it', event_date: '2026-12-26', start_time: '12:00' } as Itinerary;
    const rows: Record<string, unknown[]> = {
      drinks: [{ id: 'd1', stop: 'a' }, { id: 'd2', stop: 'b' }],
      media: [{ id: 'm1', stop: 'a', created: '1' }, { id: 'm2', stop: 'a', created: '2' }],
      messages: [{ id: 'c1' }], reactions: [{ id: 'r1' }]
    };
    const order = ['drinks', 'media', 'messages', 'reactions'];
    let call = 0;
    const opts: unknown[] = [];
    mocks.getFullList.mockImplementation(async (o: unknown) => { opts.push(o); return rows[order[call++]]; });
    Object.defineProperty(day, 'here', { get: () => ({ stop: { id: 'a' } }) });
    await day.loadFeed();
    expect(mocks.filter.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['stop.itinerary = {:id}', 'itinerary = {:id}']));
    // A stale Workbox NetworkFirst read must never undo a confirmed Tab tap or clear feedError.
    expect(opts).toHaveLength(4);
    for (const o of opts) expect(o).toMatchObject({ cache: 'no-store' });
    expect(day.feed.messages).toHaveLength(1);
    expect(day.drinks.map(d => d.id)).toEqual(['d1']);
    expect(day.media.map(m => m.id)).toEqual(['m2', 'm1']);
    expect(day.feedError).toBe(false);
  });

  it('applies a confirmed write at once and ignores a read that started before it', async () => {
    const day = new LiveDay();
    day.itinerary = { id: 'it' } as Itinerary;
    let finish!: (rows: unknown[]) => void;
    mocks.getFullList.mockImplementationOnce(() => new Promise((r) => { finish = r; })).mockResolvedValue([]);
    const stale = day.loadFeed();
    day.upsertDrink({ id: 'new', stop: 'a' } as never);
    day.upsertDrink({ id: 'new', stop: 'a' } as never);
    expect(day.feed.drinks.map((d) => d.id)).toEqual(['new']);
    finish([]);
    await stale;
    expect(day.feed.drinks.map((d) => d.id)).toEqual(['new']);
    day.dropDrink('new');
    expect(day.feed.drinks).toEqual([]);
  });

  it('keeps the last good feed and flags the error when a reload fails', async () => {
    const day = new LiveDay();
    day.itinerary = { id: 'it' } as Itinerary;
    day.feed = { drinks: [{ id: 'kept' }] as never, media: [], messages: [], reactions: [] };
    mocks.getFullList.mockRejectedValue(new Error('offline'));
    await day.loadFeed();
    expect(day.feed.drinks.map(d => d.id)).toEqual(['kept']);
    expect(day.feedError).toBe(true);
  });
});
