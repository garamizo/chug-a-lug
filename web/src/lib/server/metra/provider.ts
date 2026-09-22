import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildSchedule, servicesOn, unzipGtfs, type Schedule } from '../../metra/gtfs';
import { copy } from '../../labels';
import type { ClockContext } from '../sim/service';
import { createReplay, type ReplayDiagnostic } from './replay';
import { snapshotFeeds, type createRealtimeLoader } from './realtime';
import type { createStaticLoader, StaticStatus } from './static';

export type ProviderConfig = {
  readContext: () => Promise<ClockContext>;
  liveStatic: ReturnType<typeof createStaticLoader>;
  liveRealtime: ReturnType<typeof createRealtimeLoader>;
  recordingsDir: string; timetableUrl: string;
};
export class MetraSetupError extends Error {
  constructor() { super(copy.simFeedUnavailable); }
}
/** Static and realtime selection share one captured clock and one immutable run identity. */
export function createMetraProvider(config: ProviderConfig) {
  let selected: Promise<{ schedule: Schedule; staticStatus: StaticStatus; replay?: Awaited<ReturnType<typeof createReplay>> }> | undefined;
  let identity: string | undefined;
  async function load(context: ClockContext) {
    if (!context.enabled) return { schedule: await config.liveStatic.getSchedule(), staticStatus: config.liveStatic.status() };
    const key = JSON.stringify([context.runId, context.source, context.recordingId, context.serviceDate, context.windowStart, context.windowEnd]);
    if (identity !== undefined && identity !== key) throw new MetraSetupError();
    identity = key;
    selected ??= (async () => {
      try {
        if (context.source === 'recording') {
          const replay = await createReplay(config.recordingsDir, context.recordingId!);
          const m = replay.manifest;
          if (m.serviceDate !== context.serviceDate || m.windowStart !== context.windowStart || m.windowEnd !== context.windowEnd) throw new MetraSetupError();
          return { schedule: replay.schedule, replay, staticStatus: { publishedAt: replay.schedule.publishedAt,
            loadedAt: context.serverWallNow, source: 'file' as const } };
        }
        // Simulation cannot fetch a remote timetable, even when GTFS_URL was inherited accidentally.
        if (!config.timetableUrl.startsWith('file:')) throw new MetraSetupError();
        const schedule = buildSchedule(unzipGtfs(await readFile(fileURLToPath(config.timetableUrl))), context.serviceDate);
        const active = servicesOn(schedule, context.serviceDate);
        if (!schedule.trips.some(t => t.routeId === 'BNSF' && active.has(t.serviceId) && t.stops.length >= 2)) throw new MetraSetupError();
        return { schedule, staticStatus: { publishedAt: schedule.publishedAt, loadedAt: context.serverWallNow, source: 'file' as const } };
      } catch { throw new MetraSetupError(); }
    })();
    return selected;
  }
  return {
    async getSchedule(context?: ClockContext) { return (await load(context ?? await config.readContext())).schedule; },
    async snapshot(options: { startPolling?: boolean } = {}) {
      const context = await config.readContext();
      const loaded = await load(context);
      let realtime;
      if (!context.enabled) {
        if (options.startPolling !== false) config.liveRealtime.start();
        realtime = { ...config.liveRealtime.snapshot(new Date(context.eventNow)), diagnostics: [] as ReplayDiagnostic[] };
      } else if ('replay' in loaded && loaded.replay) {
        realtime = await loaded.replay.snapshot(context);
      } else realtime = { ...snapshotFeeds({ positions: null, tripupdates: null, alerts: null }, new Date(context.eventNow), false), diagnostics: [] as ReplayDiagnostic[] };
      return { ...realtime, schedule: loaded.schedule, staticStatus: loaded.staticStatus,
        source: context.enabled ? context.source : 'live' as const,
        revision: context.enabled ? context.revision : null,
        serviceDate: context.enabled ? context.serviceDate : null, eventNow: context.eventNow };
    }
  };
}
