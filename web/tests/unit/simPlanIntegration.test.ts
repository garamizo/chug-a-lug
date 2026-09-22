import { beforeEach, expect, it, vi } from 'vitest';
import { createClockService } from '$lib/server/sim/service';
import { fixtureSchedule } from '../fixtures/loadFixture';
const state = vi.hoisted(() => ({
  clock: null as ReturnType<typeof createClockService> | null,
  trigger: null as (() => void) | null,
  rows: [] as { collection: string; body: Record<string, unknown> }[],
  anchor: null as { stop: string; at: string; expand: { user: { is_admin: boolean } } } | null
}));
vi.mock('$lib/server/sim/clock', () => ({ simulationClock: {
  readContext: () => state.clock!.readContext(),
  withEventWrite: (...args: Parameters<ReturnType<typeof createClockService>['withEventWrite']>) => state.clock!.withEventWrite(...args)
} }));
const stops = [
  { id: 'stop00000000001', order: 1, name: 'First', kind: 'bar', station_id: 'LAGRANGE', station_name: 'La Grange', dwell_min: 60, walk_min: 5 },
  { id: 'stop00000000002', order: 2, name: 'Second', kind: 'bar', station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 4 }
];
vi.mock('$lib/server/pb', () => ({
  requireUser: async () => ({ id: 'conductor', is_admin: true }),
  adminPb: async () => ({ filter: (s: string) => s, collection: (collection: string) => ({
    getOne: async () => ({ id: 'itinerary000001', status: 'locked', event_date: '2026-12-26', start_time: '11:00' }),
    getFullList: async () => collection === 'stops' ? stops : [],
    getList: async () => ({ items: state.anchor ? [state.anchor] : [] }),
    update: async () => { state.trigger?.(); },
    delete: async () => {},
    create: async (body: Record<string, unknown>) => {
      state.rows.push({ collection, body });
      if (collection === 'checkins') state.anchor = { stop: body.stop as string, at: body.at as string, expand: { user: { is_admin: true } } };
      return { id: 'created' };
    }
  }) })
}));
vi.mock('$lib/server/metra', () => ({ metra: { getSchedule: vi.fn(async () => fixtureSchedule()) } }));
const { POST } = await import('../../src/routes/api/plan/commit/+server');
const { recomputeItinerary } = await import('$lib/server/recompute');
const { metra } = await import('$lib/server/metra');
beforeEach(() => {
  state.rows = []; state.anchor = null; state.trigger = null;
  state.clock = createClockService({ enabled: () => true, runId: () => 'test',
    read: async () => ({ runId: 'test', revision: 1, epochStart: '2026-12-26T18:00:00.000Z',
      wallStart: '2026-09-21T12:00:00.000Z', rate: 0, resumeRate: 1, serviceDate: '2026-12-26',
      source: 'timetable', recordingId: null, windowStart: '2026-12-26T06:00:00.000Z', windowEnd: '2026-12-27T06:00:00.000Z' }),
    write: async () => {} });
});
it('finishes hook-triggered recomputes and explicit commit under nested leases without deadlock', async () => {
  const pending: ReturnType<typeof recomputeItinerary>[] = [];
  state.trigger = () => { pending.push(recomputeItinerary('itinerary000001')); };
  vi.mocked(metra.getSchedule).mockImplementation(async () => {
    // Validation admits controls; every recompute after the first stop update must hold a lease.
    if (pending.length) await expect(state.clock!.change(1, { action: 'pause' })).rejects.toMatchObject({ status: 409 });
    return fixtureSchedule();
  });
  const result = await POST({ request: new Request('http://x/api/plan/commit', { method: 'POST',
    body: JSON.stringify({ itinerary: 'itinerary000001', stops, removed: [], anchorStopId: stops[0].id, clockRevision: 1 }) }) } as never);
  expect(result.status).toBe(200);
  await Promise.all(pending);
  expect(pending).toHaveLength(2);
  const logs = state.rows.filter(r => r.collection === 'event_log');
  expect(logs).toHaveLength(4);
  expect(logs.every(r => r.body.at === '2026-12-26T18:00:00.000Z')).toBe(true);
  const legs = state.rows.filter(r => r.collection === 'legs');
  expect(legs.at(-1)?.body.depart_at).toBe('2026-12-26T20:30:00.000Z');
  expect(Math.abs(Date.now() - Date.parse(legs.at(-1)!.body.computed_at as string))).toBeLessThan(10000);
  await expect(state.clock!.change(1, { action: 'pause' })).resolves.toMatchObject({ revision: 2 });
});
