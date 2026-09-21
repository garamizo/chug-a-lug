import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { FeedName } from './realtime';
import { RECORDING_FEEDS, type PollObservation } from './recording.ts';
export const snapshotName = (feed: FeedName, timestampSec: number) => `${timestampSec}.${feed}.pb`;
export type RecorderConfig = {
  base: string; token: string; fetchImpl?: typeof fetch; now?: () => Date; pollMs?: number;
  saveSnapshot: (file: string, bytes: Uint8Array) => Promise<void>;
  appendObservation: (poll: PollObservation) => Promise<void>;
};
/** One in-flight tick, real cadence >=30s, and deduplication only after durable snapshot writes. */
export function createRecorder(config: RecorderConfig) {
  const fetchImpl = config.fetchImpl ?? fetch, now = config.now ?? (() => new Date());
  const pollMs = Math.max(30_000, config.pollMs ?? 30_000);
  const saved = new Set<string>(), attemptedAt = new Map<FeedName, number>();
  let inFlight: Promise<void> | null = null, lastAttempt = -Infinity;
  function tick(): Promise<void> {
    if (inFlight) return inFlight;
    if (now().getTime() - lastAttempt < pollMs) return Promise.resolve();
    lastAttempt = now().getTime();
    inFlight = (async () => {
      for (const feed of RECORDING_FEEDS) {
        const attemptTime = now().getTime();
        if (attemptTime - (attemptedAt.get(feed) ?? -Infinity) < pollMs) continue;
        attemptedAt.set(feed, attemptTime);
        let poll: PollObservation;
        try {
          const response = await fetchImpl(`${config.base}/${feed}`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw new Error();
          const bytes = new Uint8Array(await response.arrayBuffer());
          const message = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes), epoch = Number(message.header.timestamp);
          const at = now().toISOString();
          if (!Object.hasOwn(message.header, 'timestamp') || !Number.isSafeInteger(epoch) || epoch <= 0 || epoch * 1000 > Date.parse(at)) throw new Error();
          const file = snapshotName(feed, epoch);
          if (!saved.has(file)) { await config.saveSnapshot(file, bytes); saved.add(file); }
          poll = { at, feed, ok: true, epoch };
        } catch { poll = { at: now().toISOString(), feed, ok: false }; }
        // Storage errors propagate: claiming a failure was recorded when append failed is misleading.
        await config.appendObservation(poll);
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return { tick, pollMs, snapshotsWritten: () => saved.size };
}
