import { createClockService } from '$lib/server/sim/service';
import type { ClockState } from '$lib/sim/clock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recomputeItinerary } from '$lib/server/recompute';
import { fixtureSchedule } from '../fixtures/loadFixture';

// Mutable state closed over by the mock factory (vi.hoisted runs before the mocks and the imports).
const clockSlot = vi.hoisted(() => ({ current: null as ReturnType<typeof createClockService> | null }));
vi.mock('$lib/server/sim/clock', () => ({ simulationClock: {
  readContext: () => clockSlot.current!.readContext(),
  withEventWrite: (...args: Parameters<ReturnType<typeof createClockService>['withEventWrite']>) => clockSlot.current!.withEventWrite(...args)
} }));
let simState: ClockState;
function enableSim(at = '2026-12-26T18:00:00.000Z') {
  simState = { runId: 'test', revision: 1, epochStart: at, wallStart: '2026-09-21T12:00:00.000Z',
    rate: 0, resumeRate: 1, serviceDate: '2026-12-26', source: 'timetable', recordingId: null,
    windowStart: '2026-12-25T06:00:00.000Z', windowEnd: '2026-12-28T06:00:00.000Z' };
  clockSlot.current = createClockService({ enabled: () => true, runId: () => 'test',
    read: async () => simState, write: async s => { simState = s; } });
  vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
}

const state = vi.hoisted(() => ({
  itineraryError: null as { status: number; message: string } | null,
  stops: [] as unknown[],
  checkins: [] as unknown[],
  created: [] as { collection: string; body: Record<string, unknown> }[]
}));

vi.mock('$lib/server/pb', () => ({
  adminPb: vi.fn(async () => ({
    filter: (_raw: string, params: Record<string, unknown>) => String(params.id),
    collection: (name: string) => ({
      getOne: async () => {
        if (state.itineraryError) throw Object.assign(new Error(state.itineraryError.message), { status: state.itineraryError.status });
        return { id: 'x', event_date: '2026-12-26', start_time: '11:00', status: 'locked' };
      },
      getFullList: async () => (name === 'stops' ? state.stops : []),
      getList: async () => ({ items: name === 'checkins' ? state.checkins : [] }),
      delete: async () => undefined,
      create: async (body: Record<string, unknown>) => { state.created.push({ collection: name, body }); return { id: `${name}1` }; }
    })
  }))
}));

vi.mock('$lib/server/metra', () => ({
  metra: { getSchedule: vi.fn(async () => ({ trips: [], stations: new Map(), calendars: [], exceptions: new Map(), routes: new Map() })) }
}));

const { metra } = await import('$lib/server/metra');

beforeEach(() => {
  clockSlot.current = createClockService({ enabled: () => false, runId: () => '',
    read: async () => { throw new Error('normal mode read clock'); }, write: async () => {} });
  state.itineraryError = null;
  state.stops = [];
  state.checkins = [];
  state.created = [];
  vi.mocked(metra.getSchedule).mockClear();
});

describe('recomputeItinerary', () => {
  it('resolves as a no-op when the itinerary is gone (cascade delete of a draft)', async () => {
    state.itineraryError = { status: 404, message: "The requested resource wasn't found." };

    await expect(recomputeItinerary('aaaaaaaaaaaaaaa')).resolves.toEqual({ legs: 0, impossible: 0, impossibleFromAnchor: 0 });
    expect(metra.getSchedule).not.toHaveBeenCalled();
  });

  it('never emits an unhandled rejection when a fire-and-forget recompute fails', async () => {
    state.itineraryError = { status: 500, message: 'PocketBase is down' };
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    recomputeItinerary('bbbbbbbbbbbbbbb'); // caller ignores the promise, as the internal endpoint does
    await new Promise((resolve) => setTimeout(resolve, 50));

    process.off('unhandledRejection', onUnhandled);
    expect(seen).toEqual([]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('still rejects for a caller that awaits it', async () => {
    state.itineraryError = { status: 500, message: 'PocketBase is down' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(recomputeItinerary('ccccccccccccccc')).rejects.toThrow('PocketBase is down');
    errors.mockRestore();
  });
});

describe('recomputeItinerary with an anchor', () => {
  // The anchor only steers the plan on the event's own day (`activeAnchor`, `$lib/server/plan.ts`):
  // real "today" has to actually be 2026-12-26 for these check-ins to take effect at all.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-26T15:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('plans the tail of the day from the Conductor position', async () => {
    state.stops = [
      { id: 's2', order: 2, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
      { id: 's3', order: 3, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
    ];
    state.checkins = [{ stop: 's2', at: '2026-12-26T20:00:00.000Z', expand: { user: { is_admin: true } } }];
    state.created = [];
    vi.mocked(metra.getSchedule).mockResolvedValue(fixtureSchedule());

    const result = await recomputeItinerary('ddddddddddddddd');

    expect(result.impossible).toBe(1); // 14:00 local is past BN4's 14:30 departure once the layover runs
    expect(result.impossibleFromAnchor).toBe(1); // the crawl's one leg is also its only leg from the anchor on
    const leg = state.created.find((c) => c.collection === 'legs');
    expect(leg?.body).toMatchObject({ kind: 'impossible', from_stop: 's2', to_stop: 's3' });
  });

  // The gap fix round 2 closes: `cohesionBlockers` (and so Save) never counts a leg before the
  // anchor, because it is history and the Conductor cannot fix a train that already left. Before
  // this fix, `recomputeItinerary`'s `impossible` counted it anyway, so a save could land clean by
  // the gate's own rule and still come back reporting itself broken — on a leg nobody can act on.
  it('does not count an impossible leg behind the crew, only one from the anchor onward', async () => {
    state.stops = [
      // A fake station id, absent from every trip in the fixture: no train ever connects it to
      // anything, so this leg is impossible regardless of the schedule's fine detail — and it sits
      // entirely before the anchor, run from the itinerary's plain start time, same as any leg
      // that already happened.
      { id: 's1', order: 1, station_id: 'NOWHERE', dwell_min: 10, walk_min: 5 },
      { id: 's2', order: 2, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
      { id: 's3', order: 3, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
    ];
    state.checkins = [{ stop: 's2', at: '2026-12-26T20:00:00.000Z', expand: { user: { is_admin: true } } }];
    state.created = [];
    vi.mocked(metra.getSchedule).mockResolvedValue(fixtureSchedule());

    const result = await recomputeItinerary('eeeeeeeeeeeeeee');

    expect(result.impossible).toBe(2); // s1→s2 (behind the crew) and s2→s3 (ahead of it)
    expect(result.impossibleFromAnchor).toBe(1); // only s2→s3, the one the Conductor can still fix
    const legs = state.created.filter((c) => c.collection === 'legs');
    expect(legs.find((l) => l.body.from_stop === 's1')).toMatchObject({ body: { kind: 'impossible', to_stop: 's2' } });
    expect(legs.find((l) => l.body.from_stop === 's2')).toMatchObject({ body: { kind: 'impossible', to_stop: 's3' } });
  });
});


it('leases autonomous recompute through publication across simulated midnight', async () => {
  enableSim('2026-12-27T05:59:59.000Z');
  vi.mocked(metra.getSchedule).mockImplementationOnce(async () => {
    await expect(clockSlot.current!.change(1, { action: 'seek', at: '2026-12-27T06:00:00.000Z' })).rejects.toMatchObject({ status: 409 });
    return fixtureSchedule();
  });
  await recomputeItinerary('midnight');
  expect(state.created.find(c => c.collection === 'event_log')?.body.at).toBe(simState.epochStart);
  await expect(clockSlot.current!.change(1, { action: 'seek', at: '2026-12-27T06:00:00.000Z' })).resolves.toMatchObject({ revision: 2 });
});
it('rejects an obsolete supplied recompute context without publishing', async () => {
  enableSim();
  const context = await clockSlot.current!.readContext();
  await clockSlot.current!.change(1, { action: 'pause' });
  await expect(recomputeItinerary('obsolete', context)).rejects.toMatchObject({ status: 409 });
  expect(state.created).toEqual([]);
});

afterEach(() => { vi.useRealTimers(); });
