// Immutable, disk-backed snapshots at one captured event instant. No live loader or network fallback.
import { readFile } from 'node:fs/promises';
import Bindings from 'gtfs-realtime-bindings';
import { recordingCopy } from '../../labels.ts';
import { servicesOn } from '../../metra/gtfs.ts';
import { utcInstant } from '../../sim/clock.ts';
import { loadRecording, recordingFile, RECORDING_FEEDS } from './recording.ts';
import type { FeedMessage, FeedName, Feeds, FeedStatus, RealtimeStatus } from './realtime';

export type ReplayDiagnostic = { code: 'unreadable_snapshot' | 'unmatched_trip' | 'legacy_freshness' | 'truncated_polls'; feed?: FeedName; epoch?: number; entityId?: string };
export type ReplaySnapshot = { feeds: Feeds; status: RealtimeStatus; diagnostics: ReplayDiagnostic[] };
type Entry = { at: number; epoch: number; feed: FeedName };
type Decoded = { message: FeedMessage; diagnostics: ReplayDiagnostic[]; usable: boolean };
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** First entry after eventNow, so an exact observation boundary is included. */
function upperBound(entries: Entry[], now: number) {
  let lo = 0, hi = entries.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (entries[mid].at <= now) lo = mid + 1; else hi = mid; }
  return lo;
}
export async function createReplay(root: string, id: string, options: { cacheSize?: number } = {}) {
  const capacity = options.cacheSize ?? 24;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw new Error(recordingCopy.invalid);
  const index = await loadRecording(root, id);
  const entries: Record<FeedName, Entry[]> = { positions: [], tripupdates: [], alerts: [] };
  if (index.manifest.observationsAvailable) {
    for (const o of index.observations) if (o.ok) entries[o.feed].push({ at: Date.parse(o.at), epoch: o.epoch, feed: o.feed });
  } else {
    for (const feed of RECORDING_FEEDS) entries[feed] = index.snapshots[feed].map(s => ({ at: s.epoch * 1000, epoch: s.epoch, feed }));
  }
  const active = servicesOn(index.schedule, index.manifest.serviceDate);
  const trips = new Map(index.schedule.trips.map(t => [t.id, t]));
  const cache = new Map<string, Decoded | null>();
  async function decode(entry: Entry): Promise<Decoded | null> {
    const file = `${entry.epoch}.${entry.feed}.pb`;
    if (cache.has(file)) {
      const hit = cache.get(file)!; cache.delete(file); cache.set(file, hit); return hit;
    }
    let decoded: Decoded | null = null;
    try {
      const message = Bindings.transit_realtime.FeedMessage.decode(await readFile(await recordingFile(index.dir, file)));
      if (!Object.hasOwn(message.header, 'timestamp') || Number(message.header.timestamp) !== entry.epoch) throw new Error();
      const diagnostics: ReplayDiagnostic[] = [];
      let usable = false;
      message.entity = message.entity.filter(entity => {
        const descriptor = entity.tripUpdate?.trip ?? entity.vehicle?.trip;
        if (!descriptor) return true;
        const trip = trips.get(descriptor.tripId ?? '');
        if (!trip || !active.has(trip.serviceId) ||
          (descriptor.startDate && descriptor.startDate !== index.manifest.serviceDate.replaceAll('-', '')) ||
          (descriptor.routeId && descriptor.routeId !== trip.routeId)) {
          diagnostics.push({ code: 'unmatched_trip', feed: entry.feed, epoch: entry.epoch, entityId: entity.id });
          return false;
        }
        if (entity.tripUpdate && trip.routeId === 'BNSF') usable = true;
        return true;
      });
      decoded = freeze({ message, diagnostics, usable });
    } catch { /* Missing or damaged files retain the previous valid observation's age. */ }
    cache.set(file, decoded);
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return decoded;
  }
  // Establish BNSF compatibility without retaining/decoding a whole day on normal startup.
  // Stop at the first usable observation; an entirely incompatible archive must be scanned to reject it.
  let covered = false;
  const checked = new Set<number>();
  for (const entry of entries.tripupdates) {
    if (entry.at > Date.parse(index.manifest.windowEnd)) break;
    if (checked.has(entry.epoch)) continue;
    checked.add(entry.epoch);
    if ((await decode(entry))?.usable) { covered = true; break; }
  }
  if (!covered) throw new Error(recordingCopy.invalid);

  async function snapshot(context: { eventNow: string }): Promise<ReplaySnapshot> {
    const now = Date.parse(utcInstant(context.eventNow));
    const feeds: Feeds = { positions: null, tripupdates: null, alerts: null };
    const diagnostics: ReplayDiagnostic[] = [];
    if (!index.manifest.observationsAvailable) diagnostics.push({ code: 'legacy_freshness' });
    if (index.diagnostics.truncatedTail) diagnostics.push({ code: 'truncated_polls' });
    for (const feed of RECORDING_FEEDS) {
      const visited = new Set<number>();
      for (let i = upperBound(entries[feed], now) - 1; i >= 0; i--) {
        const entry = entries[feed][i];
        if (visited.has(entry.epoch)) continue;
        visited.add(entry.epoch);
        const data = await decode(entry);
        if (!data) { diagnostics.push({ code: 'unreadable_snapshot', feed, epoch: entry.epoch }); continue; }
        diagnostics.push(...data.diagnostics);
        feeds[feed] = { message: data.message, fetchedAt: new Date(entry.at).toISOString() };
        break;
      }
    }
    const statusOf = (fetchedAt: string | null): FeedStatus => ({ fetchedAt,
      ageSec: fetchedAt === null ? null : Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 1000)), enabled: true });
    const perFeed = Object.fromEntries(RECORDING_FEEDS.map(f => [f, statusOf(feeds[f]?.fetchedAt ?? null)])) as Record<FeedName, FeedStatus>;
    const newest = RECORDING_FEEDS.map(f => feeds[f]?.fetchedAt).filter((s): s is string => !!s).sort().at(-1) ?? null;
    return freeze({ feeds, status: { ...statusOf(newest), feeds: perFeed }, diagnostics });
  }
  return { schedule: index.schedule, manifest: index.manifest, snapshot, cachedFiles: () => cache.size };
}
