import { expect, it, vi } from 'vitest';
import { initializeRehearsal } from '../../src/lib/server/sim/shared';

function harness(marker: null | { phase: 'ready' | 'seeding'; runId: string; itineraryId?: string } = null) {
  const request = vi.fn(async (method: string, path: string, body?: Record<string, unknown>): Promise<any> => {
    if (path.includes('simulationclock')) return { run_id: 'shared-rehearsal', source: 'recording', recording_id: 'recording', service_date: '2026-12-26', window_start: '2026-12-26T18:20:00Z', window_end: '2026-12-27T00:10:00Z' };
    if (method === 'GET') return { totalItems: 0, items: [] };
    if (path === '/api/crawl/login') return { record: { id: 'owner' } };
    return { id: path.includes('/stops/') ? `stop${body?.order}` : 'route' };
  });
  const config = {
    request, readMarker: vi.fn(async () => marker), writeMarker: vi.fn(async () => {}),
    finish: vi.fn(async () => {}), passwords: { crew: 'crew-test', conductor: 'admin-test' },
    scenario: { title: 'Rehearsal', serviceDate: '2026-12-26', startTime: '12:20', epochStart: '2026-12-26T18:20:00Z', windowStart: '2026-12-26T18:20:00Z', windowEnd: '2026-12-27T00:10:00Z', stops: [
      { name: 'Practice', station_id: 'CUS', station_name: 'Union Station', kind: 'bar', dwell_min: 5, walk_min: 0 },
      { name: 'Finish', station_id: 'LAGRANGE', station_name: 'La Grange Road', kind: 'bar', dwell_min: 60, walk_min: 0 }
    ] }
  };
  return config;
}
it('seeds a new practice clock and route using the ordinary shared passwords', async () => {
  const h = harness(); await initializeRehearsal(h);
  expect(h.request).toHaveBeenCalledWith('POST', '/api/crawl/login', { name: 'Rehearsal Conductor', password: 'admin-test' });
  expect(h.request.mock.calls.filter(c => c[0] === 'POST')[0][1]).toContain('simulation_clock');
  expect(h.finish).toHaveBeenCalledWith('route', ['stop1','stop2']);
  expect(h.writeMarker).toHaveBeenLastCalledWith({ phase: 'ready', runId: 'shared-rehearsal', itineraryId: 'route' });
});
it('preserves a ready run without rewriting its clock, route or actions', async () => {
  const h = harness({ phase: 'ready', runId: 'shared-rehearsal', itineraryId: 'route' });
  await initializeRehearsal(h);
  expect(h.request.mock.calls.every(c => c[0] === 'GET')).toBe(true);
  expect(h.writeMarker).not.toHaveBeenCalled(); expect(h.finish).not.toHaveBeenCalled();
});
it('refuses interrupted setup and mismatched run identity without overwriting data', async () => {
  for (const marker of [{ phase: 'seeding' as const, runId: 'shared-rehearsal' }, { phase: 'ready' as const, runId: 'another' }]) {
    const h = harness(marker); await expect(initializeRehearsal(h)).rejects.toThrow();
    expect(h.request).not.toHaveBeenCalled();
  }
});
it('does not mark the run ready when planner verification fails', async () => {
  const h = harness(); h.finish.mockRejectedValue(new Error('planner failed'));
  await expect(initializeRehearsal(h)).rejects.toThrow('planner failed');
  expect(h.writeMarker).toHaveBeenCalledTimes(1);
  expect(h.writeMarker).toHaveBeenCalledWith({ phase: 'seeding', runId: 'shared-rehearsal' });
});

it('starts a verified shared route at ten times speed after seeding conductor bulletins', async () => {
  const h = harness(); await initializeRehearsal(h);
  expect(h.request).toHaveBeenLastCalledWith('PATCH', '/api/collections/simulation_clock/records/simulationclock', expect.objectContaining({ rate: 10, resume_rate: 10, revision: 2 }));
  expect(h.request.mock.calls.filter(c => c[1].endsWith('/broadcasts/records'))).toHaveLength(3);
});
