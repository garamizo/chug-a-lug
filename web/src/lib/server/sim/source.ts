// Launcher-only source preparation. Each archive file is read separately and copied into run storage.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRecording, recordingFile, sha256, validRecordingId } from '../metra/recording.ts';
import { createReplay } from '../metra/replay.ts';
import { servicesOn } from '../../metra/gtfs.ts';
import { localToUtc } from '../../time.ts';
import { labels, simSetup } from '../../labels.ts';
import type { Scenario } from './seed.ts';
import type { SimConfig } from '../../sim/config.ts';
type SourceFile = { dir: string; file: string; target: string; hash: string };
export type SimSource = { scenario: Scenario; fixtureHash: string; recordingId: string | null; files: SourceFile[] };
export async function resolveSimSource(root: string, source: string): Promise<SimSource> {
  if (source === 'fixture') {
    const scenarioBytes = await readFile(join(root, 'web/tests/fixtures/sim/timetable/scenario.json'));
    const dir = await realpath(join(root, 'web/tests/fixtures'));
    const bytes = await readFile(await recordingFile(dir, 'gtfs.zip'));
    return { scenario: JSON.parse(scenarioBytes.toString()), recordingId: null,
      fixtureHash: createHash('sha256').update(scenarioBytes).update(bytes).digest('hex'),
      files: [{ dir, file: 'gtfs.zip', target: 'gtfs.zip', hash: sha256(bytes) }] };
  }
  if (!validRecordingId(source)) throw new Error(simSetup.invalid('SOURCE'));
  const recordingId = source === 'fixture-recording' ? 'recording' : source;
  const base = source === 'fixture-recording' ? join(root, 'web/tests/fixtures/sim') : join(root, 'data/recordings');
  const index = await loadRecording(base, recordingId);
  // Use the runtime reader's coverage rule: orphan snapshots cannot validate a replay.
  await createReplay(base, recordingId);
  const m = index.manifest, start = new Date(m.windowStart);
  // Route planning uses minute precision. Begin on the next full minute within the archived window.
  const epochStart = new Date(Math.ceil(start.getTime() / 60_000) * 60_000).toISOString();
  const startTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(epochStart));
  const active = servicesOn(index.schedule, m.serviceDate);
  const trip = index.schedule.trips.filter(t => t.routeId === 'BNSF' && active.has(t.serviceId) && t.stops.length >= 2)
    .sort((a, b) => a.stops[0].dep - b.stops[0].dep).find(t =>
      localToUtc(m.serviceDate, t.stops[0].dep).getTime() >= Date.parse(epochStart) + 60_000 &&
      localToUtc(m.serviceDate, t.stops.at(-1)!.arr).getTime() <= Date.parse(m.windowEnd));
  if (!trip) throw new Error(simSetup.invalidLegs);
  const scenario: Scenario = { title: labels.simulationMode, serviceDate: m.serviceDate, startTime, epochStart,
    windowStart: m.windowStart, windowEnd: m.windowEnd,
    stops: [trip.stops[0], trip.stops.at(-1)!].map(s => {
      const station = index.schedule.stations.get(s.stopId);
      if (!station) throw new Error(simSetup.invalidLegs);
      return { name: simSetup.seedStop(station.name), station_id: station.id, station_name: station.name,
        kind: 'other', dwell_min: 1, walk_min: 0 };
    }) };
  const files: SourceFile[] = [];
  const hash = createHash('sha256').update(JSON.stringify(scenario));
  const names = ['manifest.json', 'schedule.zip', ...(m.observationsAvailable ? ['polls.ndjson'] : []),
    ...Object.values(index.snapshots).flat().map(s => s.file)].sort();
  for (const file of names) {
    const bytes = await readFile(await recordingFile(index.dir, file)), digest = sha256(bytes);
    hash.update(file).update(digest);
    files.push({ dir: index.dir, file, target: `${recordingId}/${file}`, hash: digest });
  }
  return { scenario, recordingId, files, fixtureHash: hash.digest('hex') };
}
export async function stageSimSource(config: SimConfig, source: SimSource) {
  if (config.fixtureHash !== source.fixtureHash) throw new Error(simSetup.runMismatch);
  const base = join(config.runDir, 'fixtures');
  if ((await realpath(base)) !== base || !(await lstat(base)).isDirectory()) throw new Error(simSetup.unsafePath);
  if (source.recordingId) {
    const dir = join(base, source.recordingId);
    await mkdir(dir, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    if ((await lstat(dir)).isSymbolicLink() || (await realpath(dir)) !== dir) throw new Error(simSetup.unsafePath);
  }
  for (const file of source.files) {
    const bytes = await readFile(await recordingFile(file.dir, file.file));
    if (sha256(bytes) !== file.hash) throw new Error(simSetup.runMismatch);
    const targetDir = source.recordingId ? join(base, source.recordingId) : base;
    try {
      const existing = await readFile(await recordingFile(targetDir, file.file));
      if (sha256(existing) !== file.hash) throw new Error(simSetup.runMismatch);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await writeFile(join(base, file.target), bytes, { mode: 0o600, flag: 'wx' });
    }
  }
}
