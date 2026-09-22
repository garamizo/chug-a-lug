import { expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMetraProvider } from '../../src/lib/server/metra/provider';
import { createRealtimeLoader } from '../../src/lib/server/metra/realtime';
import { createStaticLoader } from '../../src/lib/server/metra/static';
import type { ClockContext } from '../../src/lib/server/sim/service';
const eventNow = '2026-12-26T18:24:00.000Z';
function setup(source: 'recording' | 'timetable' = 'recording') {
  const context: ClockContext = { enabled: true, runId: 'test', revision: 4, rate: 0, resumeRate: 1,
    source, recordingId: source === 'recording' ? 'recording' : null, serviceDate: '2026-12-26',
    windowStart: '2026-12-26T18:20:00.000Z', windowEnd: '2026-12-27T00:10:00.000Z',
    epochStart: eventNow, wallStart: '2026-09-21T00:00:00.000Z', eventNow,
    serverWallNow: '2026-09-21T00:00:00.000Z', ended: false };
  const fetchImpl = vi.fn();
  const rt = createRealtimeLoader({ base: 'https://invalid.test', token: 'accidental-token', fetchImpl });
  const start = vi.spyOn(rt, 'start');
  const live = createStaticLoader({ url: 'https://invalid.test', publishedUrl: 'https://invalid.test', dataDir: '/tmp/unused', fetchImpl });
  const provider = createMetraProvider({ readContext: async () => context, liveStatic: live, liveRealtime: rt,
    recordingsDir: resolve('tests/fixtures/sim'), timetableUrl: pathToFileURL(resolve('tests/fixtures/gtfs.zip')).href });
  return { context, provider, start, fetchImpl };
}
it.each(['recording', 'timetable'] as const)('%s uses its pinned schedule without starting/fetching live data', async source => {
  const { provider, start, fetchImpl } = setup(source);
  const snap = await provider.snapshot();
  expect(snap.source).toBe(source); expect(snap.revision).toBe(4);
  expect(snap.schedule.trips.length).toBeGreaterThan(0);
  expect(snap.eventNow).toBe(eventNow);
  expect(snap.staticStatus.source).toBe('file');
  if (source === 'recording') expect(snap.status.feeds.positions.ageSec).toBe(180);
  else expect(snap.feeds).toEqual({ positions: null, alerts: null, tripupdates: null });
  await provider.getSchedule();
  expect(start).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
});
it.each(['missing', 'date', 'window'])('invalid %s setup never falls back to live', async failure => {
  const { context, provider, start, fetchImpl } = setup();
  if (context.enabled) {
    if (failure === 'missing') context.recordingId = 'missing';
    if (failure === 'date') context.serviceDate = '2026-12-25';
    if (failure === 'window') context.windowEnd = '2026-12-27T01:00:00.000Z';
  }
  await expect(provider.snapshot()).rejects.toThrow();
  expect(start).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
});
it('timetable rejects a date without service', async () => {
  const { context, provider } = setup('timetable');
  if (context.enabled) context.serviceDate = '2026-12-27';
  await expect(provider.snapshot()).rejects.toThrow();
});
it('normal mode retains the live loader and snapshots at wall context time', async () => {
  const { provider, context, start, fetchImpl } = setup();
  Object.assign(context, { enabled: false });
  // The deliberately failing static source must fail before starting a realtime poll.
  await expect(provider.snapshot()).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
it('normal snapshots start the existing poller and use the captured wall instant', async () => {
  const liveStatic = createStaticLoader({ url: pathToFileURL(resolve('tests/fixtures/gtfs.zip')).href,
    publishedUrl: '', dataDir: '/tmp/unused' });
  const rt = createRealtimeLoader({ base: '', token: '' }); const start = vi.spyOn(rt, 'start');
  const readContext = vi.fn(async () => ({ enabled: false as const, eventNow, serverWallNow: eventNow }));
  const provider = createMetraProvider({ liveStatic, liveRealtime: rt, readContext, recordingsDir: '/missing', timetableUrl: '' });
  const snapshot = await provider.snapshot();
  expect(snapshot).toMatchObject({ source: 'live', revision: null, eventNow });
  expect(start).toHaveBeenCalledOnce(); expect(readContext).toHaveBeenCalledOnce();
});
it('a stations snapshot preserves the static-only request behavior in normal mode', async () => {
  const liveStatic = createStaticLoader({ url: pathToFileURL(resolve('tests/fixtures/gtfs.zip')).href,
    publishedUrl: '', dataDir: '/tmp/unused' });
  const rt = createRealtimeLoader({ base: '', token: 'token' }); const start = vi.spyOn(rt, 'start');
  const provider = createMetraProvider({ liveStatic, liveRealtime: rt,
    readContext: async () => ({ enabled: false as const, eventNow, serverWallNow: eventNow }),
    recordingsDir: '/missing', timetableUrl: '' });
  await provider.snapshot({ startPolling: false });
  expect(start).not.toHaveBeenCalled();
  rt.stop();
});
