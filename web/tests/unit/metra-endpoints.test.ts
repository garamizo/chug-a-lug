import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFeed, tripUpdate } from '../fixtures/rt';
import { fixtureSchedule } from '../fixtures/loadFixture';

type S = { fetchedAt: string | null; ageSec: number | null; enabled: boolean };
const off: S = { fetchedAt: null, ageSec: null, enabled: false };
const state = vi.hoisted(() => ({
  perFeed: {
    positions: { fetchedAt: null, ageSec: null, enabled: false },
    tripupdates: { fetchedAt: null, ageSec: null, enabled: false },
    alerts: { fetchedAt: null, ageSec: null, enabled: false }
  } as Record<'positions' | 'tripupdates' | 'alerts', S>,
  overall: { fetchedAt: null, ageSec: null, enabled: false } as S,
  feed: null as unknown
}));

vi.mock('$lib/server/pb', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', is_admin: false })) }));
vi.mock('$lib/server/metra', () => ({
  metra: { getSchedule: vi.fn(async () => fixtureSchedule()), status: () => ({ publishedAt: 'P', loadedAt: 'L', source: 'file' }) },
  metraRt: {
    start: vi.fn(),
    status: () => ({ ...state.overall, feeds: state.perFeed }),
    statusOf: (name: 'positions' | 'tripupdates' | 'alerts') => state.perFeed[name],
    feeds: () => ({ positions: null, tripupdates: state.feed, alerts: null })
  }
}));

/** Marks every feed fresh at the same moment. */
const allFresh = (ageSec = 10) => {
  const s: S = { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec, enabled: true };
  state.perFeed = { positions: { ...s }, tripupdates: { ...s }, alerts: { ...s } };
  state.overall = { ...s };
};

const get = async (mod: string, url: string) => {
  const { GET } = await import(mod);
  const res = await GET({ request: new Request(url), url: new URL(url) } as never);
  return res.json();
};

const reset = () => {
  vi.resetModules();
  state.perFeed = { positions: { ...off }, tripupdates: { ...off }, alerts: { ...off } };
  state.overall = { ...off };
  state.feed = null;
};

describe('/api/metra/status', () => {
  beforeEach(reset);

  it('reports schedule_only with no realtime', async () => {
    const body = await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status');
    expect(body.mode).toBe('schedule_only');
    expect(body.rtAgeSec).toBeNull();
  });

  it('reports live with a fresh fetch, and breaks it down per feed', async () => {
    allFresh(12);
    const body = await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status');
    expect(body).toMatchObject({ mode: 'live', rtAgeSec: 12, rtFetchedAt: '2026-12-26T20:00:00.000Z' });
    expect(body.feeds.tripupdates.mode).toBe('live');
    expect(body.feeds.alerts.mode).toBe('live');
  });

  it('reports stale past the threshold', async () => {
    allFresh(300);
    expect((await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status')).mode).toBe('stale');
  });

  it('follows the tripupdates feed even when the others are fresh', async () => {
    allFresh(10);
    state.perFeed.tripupdates = { fetchedAt: '2026-12-26T19:50:00.000Z', ageSec: 600, enabled: true };
    const body = await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status');
    expect(body.mode).toBe('stale');
    expect(body.feeds.alerts.mode).toBe('live');
    // The headline age still shows the newest fetch, which is why it must not drive the mode.
    expect(body.rtAgeSec).toBe(10);
  });
});

describe('/api/metra/next', () => {
  beforeEach(reset);

  const decodeFeed = async (tripId: string, departure: number) => ({
    fetchedAt: '2026-12-26T20:00:00.000Z',
    message: (await import('gtfs-realtime-bindings')).default.transit_realtime.FeedMessage.decode(
      encodeFeed([tripUpdate({ id: 'e', tripId, stops: [{ stopId: 'LAGRANGE', departure }] })], 1))
  });

  it('returns scheduled trips with live fields filled from the timetable', async () => {
    const body = await get('../../src/routes/api/metra/next/+server', 'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26');
    expect(body.mode).toBe('schedule_only');
    expect(body.trips.length).toBeGreaterThan(0);
    expect(body.trips[0].liveDepart).toBe(body.trips[0].schedDepart);
    expect(body.trips[0].delayMin).toBe(0);
    expect(body.trips[0].status).toBe('scheduled');
  });

  it('applies a live prediction to the matching trip', async () => {
    const first = fixtureSchedule().trips.find((t) => t.routeId === 'BNSF')!;
    allFresh(10);
    state.feed = await decodeFeed(first.id, 4102444800);
    const body = await get('../../src/routes/api/metra/next/+server', 'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26');
    expect(body.mode).toBe('live');
    const hit = body.trips.find((t: { tripId: string }) => t.tripId === first.id);
    if (hit) expect(hit.status).toBe('live');
  });

  it('ignores predictions when the tripupdates feed is stale, however fresh the others are', async () => {
    const first = fixtureSchedule().trips.find((t) => t.routeId === 'BNSF')!;
    allFresh(10);
    // Only tripupdates has rotted. The retained message is still in memory and must not be used.
    state.perFeed.tripupdates = { fetchedAt: '2026-12-26T19:50:00.000Z', ageSec: 600, enabled: true };
    state.feed = await decodeFeed(first.id, 4102444800);
    const body = await get('../../src/routes/api/metra/next/+server', 'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26');
    expect(body.mode).toBe('stale');
    expect(body.trips.every((t: { status: string }) => t.status === 'scheduled')).toBe(true);
    expect(body.trips.every((t: { liveDepart: string; schedDepart: string }) => t.liveDepart === t.schedDepart)).toBe(true);
  });
});
