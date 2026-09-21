// Validated disk format shared by recording, explicit legacy indexing and the replay provider.
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { buildSchedule, servicesOn, unzipGtfs, type Schedule } from '../../metra/gtfs.ts';
import { todayInTz } from '../../time.ts';
import { utcInstant } from '../../sim/clock.ts';
import { recordingCopy } from '../../labels.ts';
import type { FeedName } from './realtime';
export const RECORDING_FEEDS: FeedName[] = ['positions', 'tripupdates', 'alerts'];
export type RecordingMeta = { recordingId: string; serviceDate: string; windowStart: string; windowEnd: string };
export type RecordingManifest = RecordingMeta & {
  version: 1; gtfs: { file: 'schedule.zip'; sha256: string }; observationsAvailable: boolean;
  observationStart: string | null; observationEnd: string | null;
};
export type PollObservation = { at: string; feed: FeedName } & ({ ok: true; epoch: number } | { ok: false });
export type SnapshotRef = { feed: FeedName; epoch: number; file: string };
export type RecordingIndex = { dir: string; manifest: RecordingManifest; schedule: Schedule;
  observations: PollObservation[]; snapshots: Record<FeedName, SnapshotRef[]>;
  diagnostics: { truncatedTail: boolean; missingSnapshots: string[] } };
const fail = (): never => { throw new Error(recordingCopy.invalid); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
export const validRecordingId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validEpoch = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && Number.isFinite(new Date(n * 1000).getTime());
export function parseManifest(value: unknown): RecordingManifest {
  const r = object(value), gtfs = object(r.gtfs);
  if (r.version !== 1 || typeof r.recordingId !== 'string' || !validRecordingId(r.recordingId) ||
    typeof r.serviceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.serviceDate) ||
    gtfs.file !== 'schedule.zip' || typeof gtfs.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(gtfs.sha256) || typeof r.observationsAvailable !== 'boolean') fail();
  utcInstant(`${r.serviceDate}T00:00:00Z`);
  const windowStart = utcInstant(r.windowStart), windowEnd = utcInstant(r.windowEnd);
  if (windowStart >= windowEnd || todayInTz(new Date(windowStart)) !== r.serviceDate) fail();
  const observationStart = r.observationStart === null ? null : utcInstant(r.observationStart);
  const observationEnd = r.observationEnd === null ? null : utcInstant(r.observationEnd);
  if ((observationStart === null) !== (observationEnd === null) || (observationStart && observationEnd && observationStart > observationEnd)) fail();
  return { version: 1, recordingId: r.recordingId as string, serviceDate: r.serviceDate as string,
    windowStart, windowEnd, gtfs: { file: 'schedule.zip', sha256: gtfs.sha256 as string },
    observationsAvailable: r.observationsAvailable as boolean, observationStart, observationEnd };
}
export function parsePolls(text: string): { observations: PollObservation[]; truncatedTail: boolean } {
  const lines = text.split('\n'), observations: PollObservation[] = [];
  let truncatedTail = false;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); }
    catch { if (i === lines.length - 1) { truncatedTail = true; break; } return fail(); }
    const row = object(parsed), at = utcInstant(row.at);
    if (!RECORDING_FEEDS.includes(row.feed as FeedName) || typeof row.ok !== 'boolean' ||
      Object.keys(row).some(k => !(row.ok ? ['at', 'feed', 'ok', 'epoch'] : ['at', 'feed', 'ok']).includes(k))) fail();
    const feed = row.feed as FeedName;
    if (row.ok) {
      if (!validEpoch(row.epoch) || row.epoch * 1000 > Date.parse(at)) fail();
      observations.push({ at, feed, ok: true, epoch: row.epoch as number });
    } else observations.push({ at, feed, ok: false });
  }
  observations.sort((a, b) => a.at.localeCompare(b.at));
  return { observations, truncatedTail };
}
export function parseSnapshotName(file: string): SnapshotRef {
  const match = /^([1-9]\d*)\.(positions|tripupdates|alerts)\.pb$/.exec(file);
  if (!match || !validEpoch(Number(match[1]))) return fail();
  return { file, epoch: Number(match[1]), feed: match[2] as FeedName };
}
/** References must be regular files directly inside the canonical recording directory. */
export async function recordingFile(dir: string, file: string): Promise<string> {
  if (file.includes('/') || file.includes('\\') || file === '.' || file === '..') fail();
  const path = join(dir, file), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) fail();
  return path;
}
async function recordingDirectory(root: string, id: string) {
  if (!validRecordingId(id)) fail();
  const base = await realpath(root), path = join(base, id), stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) fail();
  return path;
}
export function recordingSchedule(bytes: Uint8Array, manifest: RecordingManifest): Schedule {
  if (sha256(bytes) !== manifest.gtfs.sha256) fail();
  const schedule = buildSchedule(unzipGtfs(bytes), manifest.serviceDate), active = servicesOn(schedule, manifest.serviceDate);
  if (!schedule.trips.some(t => t.routeId === 'BNSF' && active.has(t.serviceId) && t.stops.length >= 2 &&
    t.stops.every(s => schedule.stations.has(s.stopId) && Number.isFinite(s.arr) && Number.isFinite(s.dep)))) fail();
  return schedule;
}
async function listSnapshots(dir: string): Promise<Record<FeedName, SnapshotRef[]>> {
  const snapshots: Record<FeedName, SnapshotRef[]> = { positions: [], tripupdates: [], alerts: [] };
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.pb')) continue;
    const ref = parseSnapshotName(file); await recordingFile(dir, file);
    snapshots[ref.feed].push(ref);
  }
  for (const refs of Object.values(snapshots)) refs.sort((a, b) => a.epoch - b.epoch);
  return snapshots;
}
export async function loadRecording(root: string, id: string): Promise<RecordingIndex> {
  const dir = await recordingDirectory(root, id);
  const manifest = parseManifest(JSON.parse(await readFile(await recordingFile(dir, 'manifest.json'), 'utf8')));
  if (manifest.recordingId !== id) fail();
  const schedule = recordingSchedule(await readFile(await recordingFile(dir, manifest.gtfs.file)), manifest);
  const snapshots = await listSnapshots(dir);
  const polls = manifest.observationsAvailable ? parsePolls(await readFile(await recordingFile(dir, 'polls.ndjson'), 'utf8')) : { observations: [], truncatedTail: false };
  const present = new Set(Object.values(snapshots).flat().map(s => s.file));
  const missingSnapshots = [...new Set(polls.observations.flatMap(o => o.ok && !present.has(`${o.epoch}.${o.feed}.pb`) ? [`${o.epoch}.${o.feed}.pb`] : []))];
  return { dir, manifest, schedule, snapshots, observations: polls.observations,
    diagnostics: { truncatedTail: polls.truncatedTail, missingSnapshots } };
}
/** Rename only a complete file; temp bytes never have a snapshot/manifest filename. */
export async function atomicRecordingWrite(dir: string, file: string, bytes: string | Uint8Array) {
  if (file.includes('/') || file.includes('\\')) fail();
  const path = join(dir, file), temp = join(dir, `.${file}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    try { await recordingFile(dir, file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 }); await rename(temp, path);
  } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
const manifestFor = (meta: RecordingMeta, zip: Uint8Array, history: boolean) => parseManifest({ version: 1, ...meta,
  gtfs: { file: 'schedule.zip', sha256: sha256(zip) }, observationsAvailable: history, observationStart: null, observationEnd: null });
export async function createRecording(root: string, meta: RecordingMeta, zip: Uint8Array) {
  const manifest = manifestFor(meta, zip, true); recordingSchedule(zip, manifest);
  await mkdir(root, { recursive: true }); const base = await realpath(root), dir = join(base, manifest.recordingId);
  await mkdir(dir, { mode: 0o700 }); // Never resume an existing folder implicitly.
  await atomicRecordingWrite(dir, 'schedule.zip', zip);
  await writeFile(join(dir, 'polls.ndjson'), '', { flag: 'wx', mode: 0o600 });
  await atomicRecordingWrite(dir, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return { dir, manifest };
}
export async function appendPoll(dir: string, manifest: RecordingManifest, observation: PollObservation) {
  const row = parsePolls(JSON.stringify(observation) + '\n').observations[0];
  if (row.ok) await recordingFile(dir, `${row.epoch}.${row.feed}.pb`);
  await appendFile(await recordingFile(dir, 'polls.ndjson'), JSON.stringify(row) + '\n');
  manifest.observationStart = manifest.observationStart === null || row.at < manifest.observationStart ? row.at : manifest.observationStart;
  manifest.observationEnd = manifest.observationEnd === null || row.at > manifest.observationEnd ? row.at : manifest.observationEnd;
  await atomicRecordingWrite(dir, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
/** Explicit indexing scans one protobuf at a time; ordinary index loading never decodes the day. */
export async function inspectSnapshots(index: RecordingIndex) {
  let matchedTripUpdates = 0, unmatchedEntities = 0, corruptSnapshots = 0;
  const active = servicesOn(index.schedule, index.manifest.serviceDate);
  const trips = new Map(index.schedule.trips.map(t => [t.id, t]));
  for (const ref of Object.values(index.snapshots).flat()) {
    let message;
    try {
      message = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(await readFile(await recordingFile(index.dir, ref.file)));
      if (!Object.hasOwn(message.header, 'timestamp') || Number(message.header.timestamp) !== ref.epoch) throw new Error();
    } catch { corruptSnapshots++; continue; }
    for (const entity of message.entity) {
      const trip = entity.tripUpdate?.trip ?? entity.vehicle?.trip;
      if (!trip) continue;
      const scheduled = trips.get(trip.tripId ?? '');
      if (!scheduled || !active.has(scheduled.serviceId) ||
        (trip.startDate && trip.startDate !== index.manifest.serviceDate.replaceAll('-', '')) ||
        (trip.routeId && trip.routeId !== scheduled.routeId)) { unmatchedEntities++; continue; }
      if (entity.tripUpdate && scheduled.routeId === 'BNSF') matchedTripUpdates++;
    }
  }
  return { matchedTripUpdates, unmatchedEntities, corruptSnapshots };
}
export async function indexLegacy(root: string, meta: RecordingMeta, zip: Uint8Array) {
  const dir = await recordingDirectory(root, meta.recordingId);
  const lock = join(dir, '.index-lock');
  await mkdir(lock);
  try {
    for (const file of ['manifest.json', 'polls.ndjson']) {
      try { await lstat(join(dir, file)); throw new Error(recordingCopy.exists); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    const manifest = manifestFor(meta, zip, false), schedule = recordingSchedule(zip, manifest), snapshots = await listSnapshots(dir);
    if (!Object.values(snapshots).some(s => s.length)) fail();
    const index: RecordingIndex = { dir, manifest, schedule, snapshots, observations: [], diagnostics: { truncatedTail: false, missingSnapshots: [] } };
    const diagnostics = await inspectSnapshots(index);
    if (snapshots.tripupdates.length && !diagnostics.matchedTripUpdates) fail();
    try {
      if (sha256(await readFile(await recordingFile(dir, 'schedule.zip'))) !== manifest.gtfs.sha256) fail();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await atomicRecordingWrite(dir, 'schedule.zip', zip);
    }
    await atomicRecordingWrite(dir, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    return diagnostics;
  } finally { await rmdir(lock); }
}
