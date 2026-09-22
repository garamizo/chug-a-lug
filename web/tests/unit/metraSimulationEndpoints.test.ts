import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const state = vi.hoisted(() => ({ source: 'recording', id: 'recording', now: '2026-12-26T18:24:00.000Z', clockReads: 0 }));
vi.mock('$lib/server/pb', () => ({ requireUser: async () => ({ id: 'crew' }) }));
vi.mock('$lib/server/env', () => ({ serverEnv: {
  get gtfsUrl() { return pathToFileURL(resolve('tests/fixtures/gtfs.zip')).href; },
  gtfsPublishedUrl: 'https://invalid.test', dataDir: '/tmp/unused', metraRtBase: 'https://invalid.test', metraToken: 'accidental-token',
  get simRecordingsDir() { return resolve('tests/fixtures/sim'); }
} }));
vi.mock('$lib/server/sim/clock', () => ({ simulationClock: { readContext: async () => {
  state.clockReads++;
  return { enabled: true, source: state.source, recordingId: state.id, runId: 'test', revision: 9,
    serviceDate: '2026-12-26', windowStart: '2026-12-26T18:20:00.000Z', windowEnd: '2026-12-27T00:10:00.000Z',
    eventNow: state.now, serverWallNow: '2026-09-21T12:00:00.000Z' };
} } }));
beforeEach(() => { vi.resetModules(); state.source = 'recording'; state.id = 'recording'; state.now = '2026-12-26T18:24:00.000Z'; state.clockReads = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const modules = {
  next: () => import('../../src/routes/api/metra/next/+server'),
  alerts: () => import('../../src/routes/api/metra/alerts/+server'),
  status: () => import('../../src/routes/api/metra/status/+server'),
  stations: () => import('../../src/routes/api/metra/stations/+server')
};
it.each(['recording', 'timetable', 'missing'])('all endpoints isolate %s mode from live polling', async source => {
  if (source === 'timetable') state.source = source;
  if (source === 'missing') state.id = 'missing';
  const fetchSpy = vi.fn(() => { throw new Error('Unexpected network access'); }); vi.stubGlobal('fetch', fetchSpy);
  // Wrap the actual factory so even a start() that has not yet fetched is detected.
  const realtime = await import('../../src/lib/server/metra/realtime');
  const factory = realtime.createRealtimeLoader;
  const starts: ReturnType<typeof vi.spyOn>[] = [];
  vi.spyOn(realtime, 'createRealtimeLoader').mockImplementation(config => {
    const rt = factory(config); starts.push(vi.spyOn(rt, 'start')); return rt;
  });
  for (const [name, load] of Object.entries(modules)) {
    const { GET } = await load(); const url = new URL(`http://x/api/metra/${name}?from=CUS&to=AURORA`);
    const request = GET({ request: new Request(url), url } as never);
    if (source === 'missing') {
      await expect(request).rejects.toMatchObject({ status: 503, body: { message: expect.stringContaining('Rehearsal train data') } });
    } else {
      const body = await (await request).json();
      expect(body).toMatchObject({ source, revision: 9 });
      if (name === 'status') {
        expect(body.mode).toBe(source === 'recording' ? 'live' : 'schedule_only');
        if (source === 'recording') expect(body.feeds.positions).toMatchObject({ mode: 'stale', ageSec: 180 });
      }
    }
  }
  expect(state.clockReads).toBe(4);
  expect(starts).toHaveLength(1); expect(starts[0]).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
});
