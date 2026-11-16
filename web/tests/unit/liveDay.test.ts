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
const { clientClock } = await import('$lib/sim/clock.svelte');

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
      'stop.itinerary = {:id} && at >= {:start} && at < {:end}', 'itinerary = {:id} && at >= {:start} && at < {:end}',
      // Photos taken before or after the crawl have no stop, only the route.
      '(itinerary = {:id} || stop.itinerary = {:id}) && at >= {:start} && at < {:end}'
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

  it('applies a confirmed photo at once, and Undo takes it out, ignoring reads that started before', async () => {
    const day = new LiveDay();
    day.itinerary = { id: 'it' } as Itinerary;
    let finish!: (rows: unknown[]) => void;
    mocks.getFullList.mockImplementationOnce(() => new Promise((r) => { finish = r; })).mockResolvedValue([]);
    day.feed = { drinks: [], media: [{ id: 'old', stop: 'a' }] as never, messages: [], reactions: [] };
    const stale = day.loadFeed();
    day.upsertMedia({ id: 'proof', stop: 'a', drink_kind: 'beer' } as never);
    day.upsertMedia({ id: 'proof', stop: 'a', drink_kind: 'beer' } as never);
    expect(day.feed.media.map((m) => m.id)).toEqual(['old', 'proof']);
    finish([]);
    await stale;
    expect(day.feed.media.map((m) => m.id)).toEqual(['old', 'proof']);
    day.dropMedia('proof');
    expect(day.feed.media.map((m) => m.id)).toEqual(['old']);
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
    day.anchor = { stopId: 's2', at: '2026-12-26T18:00:00Z' };
    day.realNow = new Date('2026-09-22T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toBeNull();
    day.realNow = new Date('2026-12-26T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toEqual(day.anchor);
  });
  it('ignores a check-in from an earlier day on the event day, as the server does', () => {
    const day = new LiveDay();
    day.itinerary = route; day.stops = [] as never;
    day.anchor = { stopId: 's2', at: '2026-09-22T18:00:00Z' };
    day.realNow = new Date('2026-12-26T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toBeNull();
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

it('reads the route while the day is still being asked, and applies it only after the day answers', async () => {
  let answerDay!: () => void;
  mocks.fetchDay.mockReturnValue(new Promise((r) => (answerDay = () => r({ today: '2026-12-26', now: '2026-12-26T18:00:00.000Z' }))));
  mocks.resolve.mockResolvedValue(route);
  mocks.getFullList.mockResolvedValue([]);
  mocks.fetchAlerts.mockResolvedValue({ alerts: [] });
  const day = new LiveDay();
  const stop = day.start();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(day.itinerary).toBeNull();
    answerDay();
    await vi.advanceTimersByTimeAsync(0);
    expect(day.itinerary?.id).toBe('r1');
    expect(mocks.resolve).toHaveBeenCalledOnce();
  } finally { stop(); }
});

it('does not apply the early route read over a reload that started after it', async () => {
  let answerDay!: () => void;
  mocks.fetchDay.mockReturnValue(new Promise((r) => (answerDay = () => r({ today: '2026-12-26', now: '2026-12-26T18:00:00.000Z' }))));
  mocks.resolve.mockResolvedValueOnce(route).mockResolvedValue({ ...route, start_time: '12:00' });
  mocks.getFullList.mockResolvedValue([]);
  mocks.fetchAlerts.mockResolvedValue({ alerts: [] });
  const day = new LiveDay();
  const stop = day.start();
  try {
    await vi.advanceTimersByTimeAsync(0);
    await day.loadRoute();
    expect(day.itinerary?.start_time).toBe('12:00');
    answerDay();
    await vi.advanceTimersByTimeAsync(0);
    expect(day.itinerary?.start_time).toBe('12:00');
  } finally { stop(); }
});

describe('before the crawl the board waits for the planned train', () => {
  const trip = (tripId: string, depart: string) => ({
    tripId, routeId: 'BNSF', headsign: 'Chicago', schedDepart: depart, schedArrive: depart,
    liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled' as const
  });
  function plannedDay() {
    const day = new LiveDay();
    day.itinerary = route;
    day.stops = [
      { id: 'a', order: 1, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 },
      { id: 'b', order: 2, station_id: 'CUS', dwell_min: 30, walk_min: 2 }
    ] as never;
    day.legs = [{ from_stop: 'a', to_stop: 'b', kind: 'train', depart_at: '2026-12-26T18:30:00Z', arrive_at: '2026-12-26T18:55:00Z',
      segments: [{ kind: 'train', tripId: 'BN6', routeId: 'BNSF', headsign: 'Chicago', from: 'LAGRANGE', to: 'CUS', dep: '2026-12-26T18:30:00.000Z', arr: '2026-12-26T18:55:00.000Z' }] }] as never;
    return day;
  }

  it('asks for trains from just before the planned departure and counts down to it', async () => {
    mocks.fetchNext.mockResolvedValue({ trips: [trip('BN6', '2026-12-26T18:30:00.000Z'), trip('BN8', '2026-12-26T19:30:00.000Z')], mode: 'schedule_only', fetchedAt: null });
    const day = plannedDay();
    day.realNow = new Date('2026-12-26T16:00:00Z'); day.syncPlan();
    expect(day.here?.source).toBe('before');
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('LAGRANGE', 'CUS', '2026-12-26', new Date('2026-12-26T18:29:00.000Z'), false);
    expect(day.trip?.tripId).toBe('BN6');
  });

  it('prefers the planned train even when an earlier one is in the list', () => {
    const day = plannedDay();
    day.realNow = new Date('2026-12-26T16:00:00Z'); day.syncPlan();
    day.trips = [trip('BN4', '2026-12-26T17:30:00.000Z'), trip('BN6', '2026-12-26T18:30:00.000Z')];
    expect(day.trip?.tripId).toBe('BN6');
  });

  it('counts down to the next train once the crawl is under way', () => {
    const day = plannedDay();
    day.realNow = new Date('2026-12-26T17:10:00Z'); day.syncPlan();
    expect(day.here?.source).toBe('clock');
    day.trips = [trip('BN4', '2026-12-26T17:30:00.000Z'), trip('BN6', '2026-12-26T18:30:00.000Z')];
    expect(day.trip?.tripId).toBe('BN4');
  });
});

describe('a route that boards at another station', () => {
  const boardsAt = { ...route, start_station: 'AURORA', start_station_name: 'Aurora' } as Itinerary;
  const napervilleStop = { id: 'a', order: 1, station_id: 'NAPERVILLE', station_name: 'Naperville', dwell_min: 30, walk_min: 2 };
  const cusStop = { id: 'b', order: 2, station_id: 'CUS', station_name: 'Chicago Union Station', dwell_min: 30, walk_min: 2 };
  const opening = { from_stop: '', to_stop: 'a', kind: 'train', depart_at: '2026-12-26T17:20:00Z', arrive_at: '2026-12-26T17:35:00Z',
    segments: [{ kind: 'train', tripId: 'BN2', routeId: 'BNSF', headsign: 'Chicago', from: 'AURORA', to: 'NAPERVILLE', dep: '2026-12-26T17:20:00.000Z', arr: '2026-12-26T17:35:00.000Z' }] };
  const onward = { from_stop: 'a', to_stop: 'b', kind: 'train', depart_at: '2026-12-26T18:30:00Z', arrive_at: '2026-12-26T19:05:00Z',
    segments: [{ kind: 'train', tripId: 'BN6', routeId: 'BNSF', headsign: 'Chicago', from: 'NAPERVILLE', to: 'CUS', dep: '2026-12-26T18:30:00.000Z', arr: '2026-12-26T19:05:00.000Z' }] };
  function boardingDay(twoStops: boolean) {
    const day = new LiveDay();
    day.itinerary = boardsAt;
    day.stops = (twoStops ? [napervilleStop, cusStop] : [napervilleStop]) as never;
    day.legs = (twoStops ? [opening, onward] : [opening]) as never;
    return day;
  }
  beforeEach(() => { mocks.fetchNext.mockResolvedValue({ trips: [], mode: 'schedule_only', fetchedAt: null }); });

  it('before the crawl, asks for the train from the start station to stop 1, even with only one stop', async () => {
    const day = boardingDay(false);
    day.realNow = new Date('2026-12-26T16:00:00Z'); day.syncPlan();
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('AURORA', 'NAPERVILLE', '2026-12-26', new Date('2026-12-26T17:19:00.000Z'), day.practice);
    expect(day.plannedTrip).toEqual({ tripId: 'BN2', dep: '2026-12-26T17:20:00.000Z' });
  });

  it('boards to stop 1, not onward, when the route has more stops', async () => {
    const day = boardingDay(true);
    day.realNow = new Date('2026-12-26T16:00:00Z'); day.syncPlan();
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('AURORA', 'NAPERVILLE', '2026-12-26', new Date('2026-12-26T17:19:00.000Z'), day.practice);
    expect(day.boarding?.fromName).toBe('Aurora');
  });

  it('a check-in left over from the day before does not end the boarding journey', () => {
    const day = boardingDay(true);
    // A Route save on Christmas Day wrote this check-in; on the event morning it is history.
    day.anchor = { stopId: 'a', at: '2026-12-25T20:00:00Z' };
    day.realNow = new Date('2026-12-26T16:00:00Z'); day.syncPlan();
    expect(day.here?.source).toBe('before');
    expect(day.boarding?.fromName).toBe('Aurora');
    expect(day.plannedTrip).toEqual({ tripId: 'BN2', dep: '2026-12-26T17:20:00.000Z' });
  });

  it('a check-in left over from the day before does not hide the planned train without Board at', () => {
    const day = boardingDay(true);
    day.itinerary = route;
    day.legs = [onward] as never;
    day.anchor = { stopId: 'b', at: '2026-12-25T20:00:00Z' };
    day.realNow = new Date('2026-12-26T16:00:00Z'); day.syncPlan();
    expect(day.here?.source).toBe('before');
    expect(day.plannedTrip).toEqual({ tripId: 'BN6', dep: '2026-12-26T18:30:00.000Z' });
  });

  it('a Conductor check-in at stop 1 ends the boarding journey on the event day', async () => {
    const day = boardingDay(true);
    day.anchor = { stopId: 'a', at: '2026-12-26T17:25:00Z' };
    day.realNow = new Date('2026-12-26T17:26:00Z'); day.syncPlan();
    expect(day.isEventDay).toBe(true);
    expect(day.boarding).toBeNull();
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('NAPERVILLE', 'CUS', '2026-12-26', expect.any(Date), false);
  });
});

describe('the run home', () => {
  const boardsAt = { ...route, start_station: 'AURORA', start_station_name: 'Aurora' } as Itinerary;
  const stops = [
    { id: 'a', order: 1, station_id: 'NAPERVILLE', station_name: 'Naperville', dwell_min: 30, walk_min: 2 },
    { id: 'b', order: 2, station_id: 'LAGRANGE', station_name: 'La Grange', dwell_min: 30, walk_min: 2 }
  ];
  const trainSeg = { kind: 'train', tripId: 'BN9', routeId: 'BNSF', headsign: 'Aurora', from: 'LAGRANGE', to: 'AURORA', dep: '2026-12-26T23:00:00.000Z', arr: '2026-12-26T23:40:00.000Z' };
  const between = { from_stop: 'a', to_stop: 'b', kind: 'train', ready_at: '2026-12-26T20:00:00Z', depart_at: '2026-12-26T20:30:00Z', arrive_at: '2026-12-26T21:00:00Z',
    segments: [{ ...trainSeg, tripId: 'BN5', from: 'NAPERVILLE', to: 'LAGRANGE', dep: '2026-12-26T20:30:00.000Z', arr: '2026-12-26T21:00:00.000Z' }] };
  const home = { from_stop: 'b', to_stop: '', kind: 'train', ready_at: '2026-12-26T21:30:00Z', depart_at: trainSeg.dep, arrive_at: trainSeg.arr, segments: [trainSeg] };
  const trip = (tripId: string, depart: string) => ({
    tripId, routeId: 'BNSF', headsign: 'Aurora', schedDepart: depart, schedArrive: depart,
    liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled' as const
  });
  function homeDay(closing: object = home) {
    const day = new LiveDay();
    day.itinerary = boardsAt;
    day.stops = stops as never;
    day.legs = [between, closing] as never;
    return day;
  }
  beforeEach(() => { mocks.fetchNext.mockResolvedValue({ trips: [], mode: 'schedule_only', fetchedAt: null }); });

  it('at the last stop the planned train is the home train, and the board asks toward the Board at station', async () => {
    const day = homeDay();
    day.realNow = new Date('2026-12-26T22:00:00Z'); day.syncPlan();
    expect(day.here?.stop?.id).toBe('b');
    expect(day.rideHome?.riding).toBe(false);
    expect(day.plannedTrip).toEqual({ tripId: 'BN9', dep: trainSeg.dep });
    day.trips = [trip('BN7', '2026-12-26T22:30:00.000Z'), trip('BN9', trainSeg.dep)];
    expect(day.trip?.tripId).toBe('BN9');
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('LAGRANGE', 'AURORA', '2026-12-26', new Date('2026-12-26T22:59:00.000Z'), day.practice);
  });

  it('riding: no fetch, and the board carries the arrival', async () => {
    const day = homeDay();
    day.realNow = new Date('2026-12-26T23:10:00Z'); day.syncPlan();
    expect(day.rideHome).toMatchObject({ riding: true, arriveAt: trainSeg.arr });
    day.trips = [trip('BN11', '2026-12-26T23:30:00.000Z')];
    await day.loadTrains();
    expect(mocks.fetchNext).not.toHaveBeenCalled();
    // Nothing stale is left for the board to colour or count down to while the crew rides.
    expect(day.trips).toEqual([]);
    expect(day.trip).toBeNull();
  });

  it('rideHome on a practice day works off the projected clock', () => {
    const day = homeDay();
    // 4:00 PM Chicago on an ordinary September day plays the route's 4:00 PM (22:00Z on the 26th).
    day.realNow = new Date('2026-09-22T21:00:00Z'); day.syncPlan();
    expect(day.practice).toBe(true);
    expect(day.now.toISOString()).toBe('2026-12-26T22:00:00.000Z');
    expect(day.rideHome).toMatchObject({ riding: false, planned: { tripId: 'BN9' } });
    day.realNow = new Date('2026-09-22T22:30:00Z'); day.syncPlan();
    expect(day.rideHome?.riding).toBe(true);
  });

  describe('closedAt: Closing Time on the activity clock', () => {
    const at = (day: ReturnType<typeof homeDay>, iso: string) => { day.realNow = new Date(iso); day.syncPlan(); return day; };
    it('is null before the crawl is over, and the closing arrival once home on the event day', () => {
      const day = homeDay();
      expect(at(day, '2026-12-26T23:39:59Z').here?.source).not.toBe('after');
      expect(day.closedAt).toBeNull();
      at(day, '2026-12-26T23:40:00Z');
      expect(day.here?.source).toBe('after');
      expect(day.closedAt).toBe(trainSeg.arr);
    });
    it('is the same on every phone: the arrival instant, whatever each phone measured as its server offset', () => {
      // Two phones on the same rows, each with its own round-trip error (and one with a mis-set clock).
      const one = homeDay(), two = homeDay();
      one.serverOffset = 90_000; two.serverOffset = -4_000;
      at(one, '2026-12-26T23:41:00Z'); at(two, '2026-12-26T23:41:00Z');
      expect(one.closedAt).toBe(trainSeg.arr);
      expect(two.closedAt).toBe(one.closedAt);
      // Re-measured on the next poll: Closing Time does not jitter.
      one.serverOffset = 1_234;
      expect(one.closedAt).toBe(trainSeg.arr);
    });
    // That a tick leaves the timeline's reference alone is Svelte's own `$derived` caching, which this suite
    // cannot observe: vitest runs in Node and compiles `.svelte.ts` for the server, where effects never run
    // and a derived is recomputed on every read. This checks the shared timeline's contents instead.
    it('shares one spike timeline, on the day\'s date and Closing Time', () => {
      const day = homeDay();
      day.serverOffset = 0;
      const beer = (id: string, minute: number) => ({ id, user: 'u1', kind: 'beer', stop: 'a', at: `2026-12-26T20:0${minute}:00Z`, created: '', action_order: minute });
      day.feed = { drinks: [beer('d1', 1)] as never, media: [], messages: [], reactions: [] };
      at(day, '2026-12-26T23:41:00Z');
      const first = day.spikeEvents;
      expect(first.map((e) => [e.kind, e.at])).toEqual([['pathfinder', '2026-12-26T20:01:00Z'], ['caboose', trainSeg.arr]]);
      // A tick that changes neither today, Closing Time, the feed nor the stops changes nothing.
      at(day, '2026-12-26T23:41:15Z');
      day.serverOffset = 2_000;
      expect(day.spikeEvents).toEqual(first);
      // New activity does.
      day.feed = { ...day.feed, drinks: [beer('d1', 1), beer('d2', 2)] as never };
      expect(day.spikeEvents.map((e) => e.kind)).toEqual(['pathfinder', 'caboose']);
      expect(day.spikeEvents[1].user).toBe('u1');
      day.feed = { ...day.feed, drinks: [beer('d1', 1), { ...beer('d3', 3), user: 'u2', kind: 'water' }] as never };
      expect(day.spikeEvents.filter((e) => e.kind === 'caboose').map((e) => e.user)).toEqual(['u2']);
    });
    it('is null on a legacy route with no closing leg', () => {
      const day = homeDay();
      day.legs = [between] as never;
      at(day, '2026-12-27T03:00:00Z');
      expect(day.closedAt).toBeNull();
    });
    it('is null when the run home is impossible', () => {
      const day = homeDay({ ...home, kind: 'impossible', reason: 'after_midnight', segments: [] });
      at(day, '2026-12-27T03:00:00Z');
      expect(day.closedAt).toBeNull();
    });
    // Practice: the plan clock lays today's time of day onto the route date; Closing Time must flip at the
    // same real instant `here` turns `after`. 5:40 PM Chicago is the closing arrival (23:40Z in December).
    it.each([
      ['before the event date, other DST offset', '2026-09-22T22:40:00Z', '2026-09-22T22:39:59Z'],
      ['before the event date, same DST offset', '2026-02-10T23:40:00Z', '2026-02-10T23:39:59Z'],
      ['after the event date', '2027-01-12T23:40:00Z', '2027-01-12T23:39:59Z']
    ])('practice day %s: lands on today\'s activity clock', (_name, flip, justBefore) => {
      const day = homeDay();
      at(day, justBefore);
      expect(day.practice).toBe(true);
      expect(day.here?.source).not.toBe('after');
      expect(day.closedAt).toBeNull();
      at(day, flip);
      expect(day.here?.source).toBe('after');
      expect(Math.abs(Date.parse(day.closedAt!) - day.realNow.getTime())).toBeLessThan(1000);
      expect(Date.parse(day.closedAt!)).toBeLessThanOrEqual(day.realNow.getTime());
      at(day, new Date(Date.parse(flip) + 600_000).toISOString());
      expect(Date.parse(day.closedAt!)).toBe(Date.parse(flip));
    });
  });

  describe('reelReady: the reel is built from a read that started after Closing Time', () => {
    const at = (day: ReturnType<typeof homeDay>, iso: string) => { day.realNow = new Date(iso); day.syncPlan(); return day; };
    /** Holds each `loadFeed` (four lists asked together) until the test lets it answer or fail. */
    function heldReads() {
      const reads: { ok: () => void; fail: () => void; promise: Promise<unknown[]> }[] = [];
      let calls = 0;
      mocks.getFullList.mockImplementation(() => {
        const n = Math.floor(calls++ / 4);
        while (reads.length <= n) {
          let ok!: () => void, fail!: () => void;
          const promise = new Promise<unknown[]>((resolve, reject) => { ok = () => resolve([]); fail = () => reject(new Error('offline')); });
          promise.catch(() => {});
          reads.push({ ok, fail, promise });
        }
        return reads[n].promise;
      });
      return reads;
    }
    const settle = () => vi.advanceTimersByTimeAsync(0);
    function closedDay(iso = '2026-12-26T23:41:00Z') {
      const day = homeDay();
      day.enterScope(false);
      return at(day, iso);
    }
    afterEach(() => { clientClock.enabled = false; });

    it('has no scope without a route or before the clock is known, and carries the run id', () => {
      expect(new LiveDay().closingScope).toBeNull();
      const day = closedDay();
      expect(day.closingScope).toEqual({ itinerary: 'r1', date: '2026-12-26', runId: null });
      vi.spyOn(clientClock, 'runId', 'get').mockReturnValue('run-a');
      expect(day.closingScope).toEqual({ itinerary: 'r1', date: '2026-12-26', runId: 'run-a' });
      clientClock.enabled = true;
      vi.spyOn(clientClock, 'sample', 'get').mockReturnValue(null);
      expect(day.closingScope).toBeNull();
    });

    it('is not ready before Closing Time, and asks for nothing', () => {
      const day = closedDay('2026-12-26T23:39:59Z');
      heldReads();
      day.checkClosing();
      expect(day.closedAt).toBeNull();
      expect(day.closingRead).toBeNull();
      expect(day.reelReady).toBe(false);
      expect(mocks.getFullList).not.toHaveBeenCalled();
    });

    it('a read in flight when Closing Time arrives does not make it ready; the one started after it does', async () => {
      const day = closedDay('2026-12-26T23:39:00Z');
      const reads = heldReads();
      const early = day.loadFeed();
      at(day, '2026-12-26T23:40:00Z');
      expect(day.reelReady).toBe(false);
      day.checkClosing();
      expect(day.closingRead).not.toBeNull();
      // Asked once: another check in the same scope does not start a second read.
      day.checkClosing();
      expect(reads).toHaveLength(2);
      reads[0].ok(); await early;
      expect(day.reelReady).toBe(false);
      reads[1].ok(); await settle();
      expect(day.feedOkRead).toBe(day.closingRead);
      expect(day.reelReady).toBe(true);
    });

    it('stays not ready when the qualifying read fails, and turns ready on a later success', async () => {
      const day = closedDay();
      const reads = heldReads();
      day.checkClosing();
      reads[0].fail(); await settle();
      expect(day.feedError).toBe(true);
      expect(day.reelReady).toBe(false);
      const again = day.loadFeed();
      reads[1].ok(); await again;
      expect(day.reelReady).toBe(true);
    });

    it('a confirmed write is not a read: the optimistic upsert never certifies the reel', async () => {
      const day = closedDay();
      const reads = heldReads();
      day.checkClosing();
      const before = day.feedOkRead;
      day.upsertDrink({ id: 'new', stop: 'b' } as never);
      reads[0].ok(); await settle();
      expect(day.feedOkRead).toBe(before);
      expect(day.reelReady).toBe(false);
      const next = day.loadFeed();
      reads[1].ok(); await next;
      expect(day.reelReady).toBe(true);
    });

    it('a response for an old scope never certifies the new one', async () => {
      const day = closedDay();
      const reads = heldReads();
      day.checkClosing();
      // The Conductor switches the current route: same stops, new route id.
      day.itinerary = { ...day.itinerary!, id: 'r2' };
      day.enterScope(false);
      expect(day.reelReady).toBe(false);
      day.checkClosing();
      expect(day.closingScope?.itinerary).toBe('r2');
      reads[0].ok(); await settle();
      expect(day.reelReady).toBe(false);
      reads[1].ok(); await settle();
      expect(day.reelReady).toBe(true);
    });

    it('a run change resets it, and the old run\'s answer never certifies the new run', async () => {
      const runId = vi.spyOn(clientClock, 'runId', 'get').mockReturnValue('run-a');
      const day = closedDay();
      const reads = heldReads();
      day.checkClosing();
      runId.mockReturnValue('run-b');
      // The old run's read lands (the route reload has not caught up yet): it was asked for another run.
      reads[0].ok(); await settle();
      expect(day.reelReady).toBe(false);
      day.checkClosing();
      expect(day.closingScope?.runId).toBe('run-b');
      expect(day.reelReady).toBe(false);
      reads[1].ok(); await settle();
      expect(day.reelReady).toBe(true);
    });

    it('resets when Closing Time goes back to null, and the next Closing Time asks again', async () => {
      const day = closedDay();
      mocks.getFullList.mockResolvedValue([]);
      day.checkClosing(); await settle();
      expect(day.reelReady).toBe(true);
      at(day, '2026-12-26T23:30:00Z');
      expect(day.reelReady).toBe(false);
      day.checkClosing();
      expect(day.closingRead).toBeNull();
      const reads = heldReads();
      at(day, '2026-12-26T23:45:00Z');
      day.checkClosing();
      expect(day.reelReady).toBe(false);
      reads[0].ok(); await settle();
      expect(day.reelReady).toBe(true);
    });

    it('the layout asks for the read itself once the crawl closes, and a seek starts over', async () => {
      vi.setSystemTime(new Date('2026-12-26T23:41:00Z'));
      let seek!: () => void;
      vi.spyOn(clientClock, 'onRevision').mockImplementation((fn) => { seek = fn; return () => {}; });
      const day = homeDay();
      vi.spyOn(day, 'loadRoute').mockResolvedValue(undefined);
      for (const method of ['loadBulletins', 'loadTrains', 'loadAlerts'] as const) vi.spyOn(day, method).mockResolvedValue(undefined);
      mocks.fetchDay.mockRejectedValue(new Error('offline'));
      mocks.getFullList.mockResolvedValue([]);
      const stop = day.start();
      try {
        await settle();
        expect(day.closedAt).toBe(trainSeg.arr);
        expect(day.reelReady).toBe(true);
        const first = day.closingRead!;
        const reads = heldReads();
        seek();
        // A seek resets at once; the reload after it is the next qualifying read.
        expect(day.closingRead).toBeNull();
        expect(day.reelReady).toBe(false);
        await settle();
        expect(day.closingRead).toBeGreaterThan(first);
        expect(day.reelReady).toBe(false);
        reads[reads.length - 1].ok(); await settle();
        expect(day.reelReady).toBe(true);
        // The poller's next tick leaves a settled reel alone.
        const settled = day.closingRead;
        await vi.advanceTimersByTimeAsync(15_000);
        expect(day.closingRead).toBe(settled);
      } finally { stop(); }
      expect(day.closingRead).toBeNull();
    });

    it('the poller\'s tick notices Closing Time without any other trigger', async () => {
      vi.setSystemTime(new Date('2026-12-26T23:39:50Z'));
      const day = homeDay();
      vi.spyOn(day, 'loadRoute').mockResolvedValue(undefined);
      for (const method of ['loadBulletins', 'loadTrains', 'loadAlerts'] as const) vi.spyOn(day, method).mockResolvedValue(undefined);
      mocks.fetchDay.mockRejectedValue(new Error('offline'));
      mocks.getFullList.mockResolvedValue([]);
      const stop = day.start();
      try {
        await settle();
        expect(day.closedAt).toBeNull();
        expect(day.reelReady).toBe(false);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(day.closedAt).toBe(trainSeg.arr);
        expect(day.reelReady).toBe(true);
      } finally { stop(); }
    });
  });

  it('an impossible run home keeps today\'s board: nothing counts down to it', () => {
    const day = homeDay({ ...home, kind: 'impossible', reason: 'after_midnight', segments: [] });
    day.realNow = new Date('2026-12-26T22:00:00Z'); day.syncPlan();
    expect(day.here?.stop?.id).toBe('b');
    expect(day.rideHome).toBeNull();
    expect(day.plannedTrip).toBeNull();
    day.trips = [trip('BN7', '2026-12-26T22:30:00.000Z'), trip('BN9', trainSeg.dep)];
    expect(day.trip?.tripId).toBe('BN7');
  });

  it('stale legs after a terminal correction fall back to asking toward the Board at station', async () => {
    const day = homeDay();
    day.anchor = { stopId: 'b', at: '2026-12-26T22:40:00Z' };
    day.realNow = new Date('2026-12-26T23:05:00Z'); day.syncPlan();
    expect(day.isEventDay).toBe(true);
    expect(day.rideHome).toBeNull();
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('LAGRANGE', 'AURORA', '2026-12-26', expect.any(Date), false);
  });
});

describe('routeKnown: whether the current route has been read yet', () => {
  it('is false until the first read answers, then true with a route', async () => {
    mocks.resolve.mockResolvedValue(route);
    mocks.getFullList.mockResolvedValue([]);
    const day = new LiveDay();
    expect(day.routeKnown).toBe(false);
    await day.loadRoute();
    expect(day.routeKnown).toBe(true);
  });
  it('is true when the answer is that no route is locked', async () => {
    mocks.resolve.mockResolvedValue(null);
    const day = new LiveDay();
    await day.loadRoute();
    expect(day.itinerary).toBeNull();
    expect(day.routeKnown).toBe(true);
  });
  it('stays false offline with nothing remembered', async () => {
    mocks.resolve.mockRejectedValue(new Error('offline'));
    const day = new LiveDay();
    await day.loadRoute().catch(() => {});
    expect(day.routeKnown).toBe(false);
  });
});
