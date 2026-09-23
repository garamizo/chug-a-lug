// Prepare and validate the source BEFORE scripts/up.sh clears the isolated rehearsal database.
import { readFile, writeFile, mkdir, readdir, cp, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createReplay } from '../src/lib/server/metra/replay.ts';
import { loadRecording } from '../src/lib/server/metra/recording.ts';
import { buildSchedule, unzipGtfs, servicesOn } from '../src/lib/metra/gtfs.ts';
import { localToUtc, todayInTz } from '../src/lib/time.ts';
import { computeLegs } from '../src/lib/metra/compute.ts';
import { copy } from '../src/lib/labels.ts';
import { rehearsalVenues } from './rehearsal-venues.mjs';
const root = resolve(import.meta.dirname, '../..');
const date = new Date(`${todayInTz()}T12:00:00Z`);
date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7 || 7));
const serviceDate = date.toISOString().slice(0, 10);
const source = join(root, 'data/rehearsal/source');
await mkdir(source, { recursive: true });
if ((await lstat(source)).isSymbolicLink()) throw new Error('Rehearsal source must not be a symlink.');
let recording = null;
for (const name of await readdir(join(root, 'data/recordings')).catch(() => [])) {
  const manifest = await readFile(join(root, 'data/recordings', name, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (manifest?.serviceDate === serviceDate) { recording = await loadRecording(join(root, 'data/recordings'), name); break; }
}
let bytes, windowStart, windowEnd;
if (recording) {
  await createReplay(join(root, 'data/recordings'), recording.manifest.recordingId);
  bytes = await readFile(join(recording.dir, 'schedule.zip'));
  ({ windowStart, windowEnd } = recording.manifest);
  await cp(recording.dir, join(source, recording.manifest.recordingId), { recursive: true });
} else {
  if (process.env.REHEARSAL_TIMETABLE === '0') throw new Error(`No archived Metra run for ${serviceDate}. Supply a matching recording or explicitly select REHEARSAL_TIMETABLE=1. Current realtime feeds cannot reconstruct a past run.`);
  const response = await fetch(process.env.GTFS_URL || 'https://schedules.metrarail.com/gtfs/schedule.zip');
  if (!response.ok) throw new Error(`Timetable download failed: ${response.status}`);
  bytes = new Uint8Array(await response.arrayBuffer());
  windowStart = localToUtc(serviceDate, 9 * 60).toISOString();
  windowEnd = localToUtc(serviceDate, 24 * 60).toISOString();
}
const schedule = buildSchedule(unzipGtfs(bytes), serviceDate);
const active = servicesOn(schedule, serviceDate);
if (!schedule.trips.some(t => t.routeId === 'BNSF' && active.has(t.serviceId))) throw new Error(`Downloaded timetable does not cover ${serviceDate}.`);
const stations = ['AURORA', 'NAPERVILLE', 'LISLE', 'MAINST-DG', 'CLARNDNHIL', 'LAGRANGE'].map(id => {
  const station = schedule.stations.get(id);
  if (!station) throw new Error(`Missing station ${id} in archived timetable.`);
  return station;
});
const stops = await rehearsalVenues(stations, join(source, 'venues'));
const scenario = { runId: `rehearsal-${Date.now()}`, title: copy.rehearsalRouteTitle, serviceDate,
  startTime: '11:00', epochStart: windowStart, windowStart, windowEnd,
  recordingId: recording?.manifest.recordingId ?? null, stops };
const legs = computeLegs(schedule, { date: serviceDate, startMin: 660,
  stops: stops.map((stop, i) => ({ ...stop, id: String(i), order: i + 1 })) });
if (legs.length !== 11 || legs.some(l => l.kind === 'impossible' || Date.parse(l.arriveAt) > Date.parse(windowEnd))) throw new Error('The twelve-stop route does not fit this timetable and playback window.');
const firstDeparture = Math.min(...legs.filter(l => l.kind === 'train').map(l => Date.parse(l.departAt)));
scenario.epochStart = new Date(firstDeparture - 3600_000).toISOString();
if (scenario.epochStart < windowStart || scenario.epochStart >= windowEnd) throw new Error('The recording must cover one hour before departure.');
await writeFile(join(source, 'schedule.zip'), bytes);
await writeFile(join(source, 'scenario.json'), JSON.stringify(scenario, null, 2));
console.log(`Prepared ${serviceDate}: ${recording ? 'recorded run' : 'timetable only'}, twelve stops.`);
