import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '$lib/types';

const mocks = vi.hoisted(() => ({
  getList: vi.fn(), getFullList: vi.fn(), getOne: vi.fn(), filter: vi.fn((raw: string, _params: unknown) => raw),
  resolve: vi.fn(), fetchDay: vi.fn(), fetchNext: vi.fn(), fetchAlerts: vi.fn(),
  callbacks: new Map<string, () => void>(), unsubs: [] as ReturnType<typeof vi.fn>[]
}));
vi.mock('$lib/pb', () => ({
  pb: { collection: () => ({ getList: mocks.getList, getFullList: mocks.getFullList, getOne: mocks.getOne }), filter: mocks.filter, authStore: { record: { id: 'me' } } },
  subscribe: (name: string, _filter: string, callback: () => void) => {
    mocks.callbacks.set(name, callback);
    const unsub = vi.fn(); mocks.unsubs.push(unsub); return unsub;
  }
}));
vi.mock('$lib/live/route', () => ({ resolveCurrentRoute: mocks.resolve }));
vi.mock('$lib/live/feed', () => ({ fetchStatus: async () => ({ mode: 'schedule_only' }), fetchDay: mocks.fetchDay, fetchNext: mocks.fetchNext, fetchAlerts: mocks.fetchAlerts }));
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
      // The first route load waits for the day, so it enters a scope on the server's day.
      await vi.advanceTimersByTimeAsync(0);
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
    await vi.advanceTimersByTimeAsync(0);
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
    expect(mocks.filter.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([
      'stop.itinerary = {:id} && at >= {:start} && at < {:end}', 'itinerary = {:id} && at >= {:start} && at < {:end}'
    ]));
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

const route = { id: 'r1', event_date: '2026-12-26', start_time: '11:00', status: 'locked' } as Itinerary;

describe('practice days', () => {
  it('is a practice day on any other date, with plan time on the route date', () => {
    const day = new LiveDay();
    day.itinerary = route;
    day.realNow = new Date('2026-09-22T19:05:00Z');
    day.syncPlan();
    expect(day.hasRoute).toBe(true);
    expect(day.isEventDay).toBe(false);
    expect(day.practice).toBe(true);
    expect(day.now.toISOString()).toBe('2026-12-26T20:05:00.000Z');
  });
  it('ignores the Conductor’s position on a practice day', () => {
    const day = new LiveDay();
    day.itinerary = route; day.stops = [] as never;
    day.anchor = { stopId: 's2', at: '2026-09-22T18:00:00Z' };
    day.realNow = new Date('2026-09-22T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toBeNull();
    day.realNow = new Date('2026-12-26T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toEqual(day.anchor);
  });
  it('asks for timetable-only trains on a practice day and skips alerts', async () => {
    mocks.fetchNext.mockResolvedValue({ trips: [], mode: 'schedule_only', fetchedAt: null });
    const day = new LiveDay();
    day.itinerary = route;
    day.stops = [
      { id: 'a', order: 1, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 },
      { id: 'b', order: 2, station_id: 'CUS', dwell_min: 30, walk_min: 2 }
    ] as never;
    day.legs = [{ from_stop: 'a', to_stop: 'b', kind: 'train', depart_at: '2026-12-26T20:34:00Z', arrive_at: '2026-12-26T20:49:00Z' }] as never;
    day.realNow = new Date('2026-09-22T17:30:00Z'); day.syncPlan();
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('LAGRANGE', 'CUS', '2026-12-26', day.now, true);
    await day.loadAlerts();
    expect(mocks.fetchAlerts).not.toHaveBeenCalled();
    expect(day.alerts).toEqual([]);
  });
});

describe('one day at a time', () => {
  it('reads activity only inside the server day', async () => {
    mocks.getFullList.mockResolvedValue([]);
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-24T18:00:00Z');
    await day.loadFeed();
    const filters = mocks.filter.mock.calls.map((c) => [c[0], c[1]]);
    expect(filters).toContainEqual([expect.stringContaining('at >= {:start} && at < {:end}'), expect.objectContaining({ start: new Date('2026-09-24T05:00:00.000Z'), end: new Date('2026-09-25T05:00:00.000Z') })]);
    // Dates, not ISO strings: pb.filter writes a Date in PocketBase's stored form ("… 05:00:00.000Z"),
    // while a "T" string compares as text and would exclude every row of the day.
    for (const [, params] of filters) {
      const p = params as { start?: unknown };
      if (p?.start !== undefined) expect(p.start).toBeInstanceOf(Date);
    }
    expect(filters).toContainEqual([expect.stringContaining('created >= {:start} && created < {:end}'), expect.anything()]);
  });
  it('limits Bulletins to the day, and acks to those Bulletins', async () => {
    mocks.getFullList.mockResolvedValueOnce([{ id: 'b1' }]).mockResolvedValueOnce([]);
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-24T18:00:00Z');
    await day.loadBulletins();
    const texts = mocks.filter.mock.calls.map((c) => c[0]);
    expect(texts).toContainEqual(expect.stringContaining('itinerary = {:id} && at >= {:start} && at < {:end}'));
    expect(texts).toContainEqual(expect.stringContaining('broadcast.itinerary = {:id} && broadcast.at >= {:start}'));
  });
  const yesterday = () => {
    const day = new LiveDay();
    day.itinerary = route; day.realNow = new Date('2026-09-25T04:58:00Z');   // 23:58 CDT on the 24th
    day.serverOffset = 0; day.enterScope(false);
    day.feed = { drinks: [{ id: 'd1' }], media: [{ id: 'm1' }], messages: [{ id: 'c1' }], reactions: [] } as never;
    day.bulletins = [{ id: 'b1' }] as never;
    return day;
  };
  it('empties yesterday’s activity at midnight even when every reload fails', async () => {
    mocks.getFullList.mockRejectedValue(new Error('offline'));
    const day = yesterday();
    expect(day.pinnedBulletin?.id).toBe('b1');
    day.realNow = new Date('2026-09-25T05:01:00Z');                          // 00:01 on the 25th
    await day.checkScope();
    expect(day.today).toBe('2026-09-25');
    expect(day.feed.messages).toEqual([]);
    expect(day.feed.drinks).toEqual([]);
    expect(day.bulletins).toEqual([]);
    expect(day.pinnedBulletin).toBeNull();
  });
  it('drops a read that started yesterday and answers after midnight', async () => {
    const answers: ((rows: unknown[]) => void)[] = [];   // Bulletins and acks are read together
    mocks.getFullList.mockImplementation(() => new Promise((r) => { answers.push(r); }));
    const day = yesterday();
    const late = day.loadBulletins();
    day.realNow = new Date('2026-09-25T05:01:00Z'); day.enterScope(false);
    answers.forEach((answer) => answer([{ id: 'b-old' }])); await late;
    expect(day.bulletins).toEqual([]);
  });
  it('keeps counting the server’s day while the day endpoint is unreachable', async () => {
    // The phone is a day behind (e2e fakes it); the server said so once, then went quiet.
    mocks.fetchDay.mockResolvedValueOnce({ today: '2026-09-24', now: '2026-09-24T18:00:00.000Z' }).mockRejectedValue(new Error('offline'));
    const day = new LiveDay();
    day.realNow = new Date('2026-09-23T18:00:00Z');
    await day.loadDay();
    expect(day.today).toBe('2026-09-24');
    day.realNow = new Date('2026-09-24T12:00:00Z');                          // 18 h later on the phone
    await day.loadDay();
    expect(day.today).toBe('2026-09-25');
  });
  it('uses the phone’s own date before the server has ever answered', async () => {
    mocks.fetchDay.mockRejectedValue(new Error('offline'));
    const day = new LiveDay();
    day.realNow = new Date('2026-09-24T18:00:00Z');
    await day.loadDay();
    expect(day.today).toBe('2026-09-24');
  });
});

describe('switching the current route', () => {
  const two = { id: 'r2', event_date: '2026-12-12', start_time: '11:00', status: 'locked' } as Itinerary;
  it('clears the old route’s trains, feed and Bulletins before the new ones arrive', async () => {
    mocks.getFullList.mockImplementation(() => new Promise(() => {}));   // reloads never answer
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-24T18:00:00Z'); day.enterScope(false);
    day.trips = [{ tripId: 'old' }] as never; day.feed.messages = [{ id: 'c1' }] as never; day.bulletins = [{ id: 'b1' }] as never;
    day.itinerary = two; day.enterScope(false);
    expect(day.trips).toEqual([]);
    expect(day.feed.messages).toEqual([]);
    expect(day.bulletins).toEqual([]);
  });
  it('drops a train answer for the previous route', async () => {
    let answer!: (v: unknown) => void;
    mocks.fetchNext.mockImplementation(() => new Promise((r) => { answer = r; }));
    const day = new LiveDay();
    day.itinerary = route;
    day.stops = [
      { id: 'a', order: 1, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 },
      { id: 'b', order: 2, station_id: 'CUS', dwell_min: 30, walk_min: 2 }
    ] as never;
    day.legs = [{ from_stop: 'a', to_stop: 'b', kind: 'train', depart_at: '2026-12-26T20:34:00Z', arrive_at: '2026-12-26T20:49:00Z' }] as never;
    day.realNow = new Date('2026-09-22T17:30:00Z'); day.syncPlan();
    const late = day.loadTrains();
    day.itinerary = two; day.enterScope(false);
    answer({ trips: [{ tripId: 'old-route' }], mode: 'schedule_only', fetchedAt: null }); await late;
    expect(day.trips).toEqual([]);
  });
});

it('asks for trains, the feed and Bulletins once when the first route load enters its scope', async () => {
  mocks.resolve.mockResolvedValue(route);
  mocks.getFullList.mockResolvedValue([]);
  mocks.fetchDay.mockRejectedValue(new Error('offline'));
  mocks.fetchAlerts.mockResolvedValue({ alerts: [] });
  const day = new LiveDay();
  const loads = (['loadTrains', 'loadFeed', 'loadBulletins'] as const).map((m) => vi.spyOn(day, m));
  const stop = day.start();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(day.itinerary?.id).toBe('r1');
    // A second train request would race the first, and the later answer wins whatever it says.
    for (const load of loads) expect(load).toHaveBeenCalledOnce();
  } finally { stop(); }
});

describe('alerts stay empty on a practice day', () => {
  it('drops alerts fetched before the route turned out to be a practice day', async () => {
    let answer!: (v: unknown) => void;
    mocks.fetchAlerts.mockImplementation(() => new Promise((r) => { answer = r; }));
    const day = new LiveDay();
    day.realNow = new Date('2026-09-22T17:30:00Z'); day.syncPlan();
    const early = day.loadAlerts();                       // no route yet: not a practice day
    day.itinerary = route; day.syncPlan();
    answer({ alerts: [{ id: 'a1' }] }); await early;
    expect(day.alerts).toEqual([]);
  });
  it('clears event-day alerts when the route becomes a practice route', async () => {
    mocks.resolve.mockResolvedValue(route);
    mocks.getFullList.mockResolvedValue([]);
    const day = new LiveDay();
    day.realNow = new Date('2026-09-22T17:30:00Z');
    day.itinerary = { ...route, id: 'today', event_date: '2026-09-22' }; day.syncPlan();
    day.alerts = [{ id: 'a1' }] as never;
    await day.loadRoute();
    expect(day.practice).toBe(true);
    expect(day.alerts).toEqual([]);
  });
  it('starts on a practice route with no alerts even though the feed has some', async () => {
    mocks.resolve.mockResolvedValue(route);
    mocks.getFullList.mockResolvedValue([]);
    mocks.fetchDay.mockRejectedValue(new Error('offline'));
    mocks.fetchAlerts.mockResolvedValue({ alerts: [{ id: 'a1' }] });
    vi.setSystemTime(new Date('2026-09-22T17:30:00Z'));
    const day = new LiveDay();
    const stop = day.start();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(day.practice).toBe(true);
      expect(day.alerts).toEqual([]);
    } finally { stop(); }
  });
});

describe('the Conductor’s position belongs to its route', () => {
  it('forgets the old route’s anchor on a switch, but keeps it across midnight', () => {
    mocks.getList.mockImplementation(() => new Promise(() => {}));
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-25T04:58:00Z'); day.enterScope(false);
    day.anchor = { stopId: 's1', at: '2026-09-25T04:00:00Z' };
    day.realNow = new Date('2026-09-25T05:01:00Z'); day.enterScope(false);
    expect(day.anchor).toEqual({ stopId: 's1', at: '2026-09-25T04:00:00Z' });
    day.itinerary = { ...route, id: 'r2' }; day.enterScope(false);
    expect(day.anchor).toBeNull();
  });
});
