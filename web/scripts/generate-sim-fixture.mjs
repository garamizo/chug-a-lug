#!/usr/bin/env node
// Fixed epochs, payloads, order and copied zip: regeneration must be byte-identical.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { sha256, parseManifest, parsePolls, recordingSchedule } from '../src/lib/server/metra/recording.ts';
import { recordingCopy } from '../src/lib/labels.ts';
const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const directory = fileURLToPath(new URL('../tests/fixtures/sim/recording/', import.meta.url));
const epoch = iso => Date.parse(iso) / 1000;
const iso = time => `2026-12-26T${time}:00.000Z`;
const files = new Map();
function snapshot(feed, at, entity) {
  const timestamp = epoch(at), name = `${timestamp}.${feed}.pb`;
  const encoded = FeedMessage.encode(FeedMessage.fromObject({ header: { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp }, entity })).finish();
  files.set(name, new Uint8Array(encoded)); // Copy Buffer's slice; never use its pooled .buffer.
  return timestamp;
}
const trip = (id, canceled = false) => ({ tripId: id, routeId: 'BNSF', startDate: '20261226', scheduleRelationship: canceled ? 3 : 0 });
const update = (delayMin = 0) => [{ id: 'fixture-bn1', tripUpdate: { trip: trip('BN1'), stopTimeUpdate: [
  { stopId: 'CUS', departure: { time: epoch(iso('18:33')) + delayMin * 60 } },
  { stopId: 'LAGRANGE', arrival: { time: epoch(iso('18:55')) + delayMin * 60 } }
] } }];
const normal = snapshot('tripupdates', iso('18:20'), update());
const delayed = snapshot('tripupdates', iso('18:21'), update(5));
const canceled = snapshot('tripupdates', iso('18:22'), [...update(5), { id: 'fixture-canceled', tripUpdate: { trip: trip('BN3', true) } }]);
const position = snapshot('positions', iso('18:21'), [{ id: 'fixture-position', vehicle: { trip: trip('BN1'),
  position: { latitude: 41.879, longitude: -87.64 }, timestamp: epoch(iso('18:21')) } }]);
const alert = (text, start, end) => ({ id: 'fixture-alert', alert: {
  activePeriod: [{ start: epoch(start), ...(end ? { end: epoch(end) } : {}) }],
  informedEntity: [{ routeId: 'BNSF' }], effect: 2,
  headerText: { translation: [{ text, language: 'en' }] }
} });
const initialAlert = snapshot('alerts', iso('18:20'), [alert('Fixture delay', iso('18:20'), '2026-12-26T18:21:30.000Z')]);
const night = '2026-12-26T23:59:30.000Z';
const nightAlert = snapshot('alerts', night, [alert('Fixture overnight notice', night)]);
const observations = [];
function poll(at, positions, tripupdates, alerts) {
  for (const [feed, stamp] of Object.entries({ positions, tripupdates, alerts })) {
    observations.push({ at, feed, ok: stamp !== null, ...(stamp === null ? {} : { epoch: stamp }) });
  }
}
poll(iso('18:20'), null, normal, initialAlert);
poll('2026-12-26T18:20:30.000Z', null, normal, initialAlert);
poll(iso('18:21'), position, delayed, initialAlert);
poll(iso('18:22'), null, canceled, initialAlert);
poll(iso('18:24'), null, canceled, initialAlert);
poll(iso('18:25'), null, null, initialAlert);
poll(night, null, null, nightAlert);
poll('2026-12-27T00:00:00.000Z', null, canceled, nightAlert);
const zip = await readFile(new URL('../tests/fixtures/gtfs.zip', import.meta.url));
const manifest = parseManifest({ version: 1, recordingId: 'recording', serviceDate: '2026-12-26',
  windowStart: iso('18:20'), windowEnd: '2026-12-27T00:10:00.000Z', gtfs: { file: 'schedule.zip', sha256: sha256(zip) },
  observationsAvailable: true, observationStart: observations[0].at, observationEnd: observations.at(-1).at });
recordingSchedule(zip, manifest);
const polls = observations.map(o => JSON.stringify(o)).join('\n') + '\n'; parsePolls(polls);
files.set('schedule.zip', zip); files.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n'); files.set('polls.ndjson', polls);
await mkdir(directory, { recursive: true });
for (const [file, bytes] of files) await writeFile(join(directory, file), bytes);
console.log(recordingCopy.generated);
console.log([...files.keys()].sort().join('\n'));
