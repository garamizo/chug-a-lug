import { createClockService } from '$lib/server/sim/service';
import type { ClockState } from '$lib/sim/clock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSchedule } from '../fixtures/loadFixture';

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
  user: { id: 'u1', is_admin: true } as { id: string; is_admin: boolean },
  itinerary: { id: 'itinerary000001', status: 'locked', event_date: '2026-12-26', start_time: '11:00' } as Record<string, unknown>
}));

vi.mock('$lib/server/pb', () => ({
  requireUser: vi.fn(async () => state.user),
  adminPb: vi.fn(async () => ({
    filter: (raw: string) => raw,
    collection: () => ({ getOne: async () => state.itinerary })
  }))
}));
vi.mock('$lib/server/metra', () => ({ metra: { getSchedule: vi.fn(async () => fixtureSchedule()) } }));

const { POST } = await import('../../src/routes/api/plan/preview/+server');

const call = (body: unknown) =>
  POST({ request: new Request('http://x/api/plan/preview', { method: 'POST', body: JSON.stringify(body) }) } as never);

const stops = [
  { id: 's2', order: 2, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
  { id: 's3', order: 3, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
];

beforeEach(() => {
  clockSlot.current = createClockService({ enabled: () => false, runId: () => '',
    read: async () => { throw new Error('normal mode read clock'); }, write: async () => {} });
  state.user = { id: 'u1', is_admin: true };
  state.itinerary = { id: 'itinerary000001', status: 'locked', event_date: '2026-12-26', start_time: '11:00' };
});

describe('POST /api/plan/preview', () => {
  it('plans the submitted stops from the anchor moment', async () => {
    vi.setSystemTime(new Date('2026-12-26T18:00:00.000Z')); // 12:00 local
    const res = await call({ itinerary: 'itinerary000001', anchorStopId: 's2', stops });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Ready at 13:00 local, on the platform at 13:05, so BN4 at 14:30 into Union Station at 14:55.
    expect(body.legs[0]).toMatchObject({ kind: 'train', departAt: '2026-12-26T20:30:00.000Z', arriveAt: '2026-12-26T20:59:00.000Z' });
    expect(body.anchorAt).toBe('2026-12-26T18:00:00.000Z');
    vi.useRealTimers();
  });

  it('plans from the itinerary start time with no anchor', async () => {
    const res = await call({ itinerary: 'itinerary000001', stops });
    const body = await res.json();
    expect(body.anchorAt).toBeNull();
    expect(body.legs[0]).toMatchObject({ readyAt: '2026-12-26T18:00:00.000Z' });
  });

  it('refuses a body with no stops', async () => {
    await expect(call({ itinerary: 'itinerary000001', stops: [] })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a stop list that is not shaped like stops', async () => {
    await expect(call({ itinerary: 'itinerary000001', stops: [{ id: 's1' }] })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a malformed itinerary id before any planning happens', async () => {
    await expect(call({ itinerary: 'it1', stops })).rejects.toMatchObject({ status: 400 });
  });
});


it.each([
  ['2026-12-26T05:59:59.000Z', null],
  ['2026-12-26T06:00:00.000Z', '2026-12-26T06:00:00.000Z'],
  ['2026-12-27T05:59:59.000Z', '2026-12-27T05:59:59.000Z'],
  ['2026-12-27T06:00:00.000Z', null]
])('gates preview by simulated Chicago date at %s', async (at, anchorAt) => {
  enableSim(at);
  const res = await call({ itinerary: 'itinerary000001', anchorStopId: 's2', stops });
  expect(await res.json()).toMatchObject({ anchorAt, clockRevision: 1 });
});

afterEach(() => { vi.useRealTimers(); });
