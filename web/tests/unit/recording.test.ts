import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadRecording, parseManifest, parsePolls, createRecording, indexLegacy, inspectSnapshots, appendPoll, atomicRecordingWrite } from '../../src/lib/server/metra/recording';
import { encodeFeed, tripUpdate } from '../fixtures/rt';
const zipPath = resolve('tests/fixtures/gtfs.zip');
const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
const meta = { recordingId: 'test', serviceDate: '2026-12-26', windowStart: '2026-12-26T18:00:00.000Z', windowEnd: '2026-12-27T00:10:00.000Z' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'recording-test-')); roots.push(root);
  const zip = await readFile(zipPath);
  const manifest = { version: 1, ...meta, gtfs: { file: 'schedule.zip', sha256: createHash('sha256').update(zip).digest('hex') },
    observationsAvailable: true, observationStart: null, observationEnd: null };
  const dir = join(root, 'test'); await mkdir(dir);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'schedule.zip'), zip); await writeFile(join(dir, 'polls.ndjson'), '');
  return { root, dir, manifest, zip };
}
describe('recording metadata', () => {
  it('loads the original Chicago date and verifies usable BNSF service', async () => {
    const { root } = await fixture(), index = await loadRecording(root, 'test');
    expect(index.manifest.serviceDate).toBe('2026-12-26');
    expect(index.schedule.trips.some(t => t.routeId === 'BNSF')).toBe(true);
  });
  it.each([{ version: 2 }, { serviceDate: '2026-02-30' }, { windowEnd: meta.windowStart },
    { windowStart: '2026-12-26T18:00:00' }, { recordingId: '../test' },
    { observationStart: meta.windowEnd, observationEnd: meta.windowStart },
    { gtfs: { file: '../schedule.zip', sha256: 'a'.repeat(64) } }])('rejects incompatible manifest %j', async patch => {
    const { manifest } = await fixture(); expect(() => parseManifest({ ...manifest, ...patch })).toThrow();
  });
  it('rejects an archived zip hash mismatch and a missing zip', async () => {
    const { root, dir } = await fixture(); await writeFile(join(dir, 'schedule.zip'), 'bad');
    await expect(loadRecording(root, 'test')).rejects.toThrow();
    await rm(join(dir, 'schedule.zip')); await expect(loadRecording(root, 'test')).rejects.toThrow();
  });
  it('rejects a date without usable BNSF service', async () => {
    const { root, dir, manifest } = await fixture();
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, serviceDate: '2026-12-27', windowStart: '2026-12-27T18:00:00Z', windowEnd: '2026-12-27T20:00:00Z' }));
    await expect(loadRecording(root, 'test')).rejects.toThrow();
  });
  it('rejects traversal, mismatched IDs, invalid snapshot names and symlink escapes', async () => {
    const { root, dir, manifest } = await fixture();
    await expect(loadRecording(root, '../test')).rejects.toThrow();
    await symlink(dir, join(root, 'alias')); await expect(loadRecording(root, 'alias')).rejects.toThrow();
    await writeFile(join(dir, 'nope.alerts.pb'), 'bad'); await expect(loadRecording(root, 'test')).rejects.toThrow();
    await rm(join(dir, 'nope.alerts.pb'));
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, recordingId: 'other' }));
    await expect(loadRecording(root, 'test')).rejects.toThrow();
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    await symlink(zipPath, join(dir, '1798308000.alerts.pb')); await expect(loadRecording(root, 'test')).rejects.toThrow();
  });
  it('reports a truncated final poll but rejects damaged complete lines', () => {
    const poll = { at: meta.windowStart, feed: 'alerts', ok: true, epoch: Date.parse(meta.windowStart) / 1000 };
    const result = parsePolls(JSON.stringify(poll) + '\n{"at":');
    expect(result.observations).toEqual([poll]); expect(result.truncatedTail).toBe(true);
    expect(() => parsePolls('{bad}\n' + JSON.stringify(poll) + '\n')).toThrow();
  });
  it('retains successful unchanged polls and independent failures; rejects future epochs', () => {
    const rows = [{ at: meta.windowStart, feed: 'alerts', ok: true, epoch: Date.parse(meta.windowStart) / 1000 },
      { at: '2026-12-26T18:00:30.000Z', feed: 'alerts', ok: true, epoch: Date.parse(meta.windowStart) / 1000 },
      { at: '2026-12-26T18:00:30.000Z', feed: 'positions', ok: false }];
    expect(parsePolls(rows.map(r => JSON.stringify(r)).join('\n') + '\n').observations).toEqual(rows);
    expect(() => parsePolls(JSON.stringify({ ...rows[0], epoch: Date.parse(meta.windowEnd) / 1000 }) + '\n')).toThrow();
    expect(() => parsePolls(JSON.stringify({ ...rows[2], token: 'secret' }) + '\n')).toThrow();
  });
  it('archives first, creates no active poll history, and refuses overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recording-test-')); roots.push(root);
    await createRecording(root, meta, await readFile(zipPath));
    expect((await loadRecording(root, 'test')).observations).toEqual([]);
    await expect(createRecording(root, meta, await readFile(zipPath))).rejects.toThrow();
  });
  it('legacy indexing requires matching inputs and never invents poll history', async () => {
    const { root, dir, zip } = await fixture(); await rm(join(dir, 'manifest.json')); await rm(join(dir, 'polls.ndjson'));
    const epoch = Date.parse(meta.windowStart) / 1000;
    await writeFile(join(dir, `${epoch}.tripupdates.pb`), encodeFeed([tripUpdate({ id: 'bn', tripId: 'BN1', startDate: '20261226' })], epoch));
    await indexLegacy(root, meta, zip);
    const result = await loadRecording(root, 'test');
    expect(result.manifest.observationsAvailable).toBe(false); expect(result.observations).toEqual([]);
    expect(result.snapshots.tripupdates).toHaveLength(1);
    await expect(indexLegacy(root, meta, zip)).rejects.toThrow();
  });
});
it('the deterministic fixture covers valid BNSF predictions, outages, unchanged polls and UTC midnight', async () => {
  const index = await loadRecording(resolve('tests/fixtures/sim'), 'recording');
  expect(index.observations.some(o => !o.ok && o.feed === 'positions')).toBe(true);
  expect(index.observations.some(o => o.at.startsWith('2026-12-27'))).toBe(true);
  const seen = new Set<string>();
  expect(index.observations.some(o => { if (!o.ok) return false; const key = `${o.feed}:${o.epoch}`; const old = seen.has(key); seen.add(key); return old; })).toBe(true);
  const diagnostics = await inspectSnapshots(index);
  expect(diagnostics.unmatchedEntities).toBe(0); expect(diagnostics.matchedTripUpdates).toBeGreaterThan(0);
});
it('keeps absent protobuf fields absent and encodes normal, delayed and canceled trips', async () => {
  const { default: bindings } = await import('gtfs-realtime-bindings');
  const index = await loadRecording(resolve('tests/fixtures/sim'), 'recording');
  const decode = async (file: string) => bindings.transit_realtime.FeedMessage.decode(new Uint8Array(await readFile(join(index.dir, file))));
  const normal = await decode(index.snapshots.tripupdates[0].file), delayed = await decode(index.snapshots.tripupdates[1].file);
  const first = normal.entity[0].tripUpdate!.stopTimeUpdate![0];
  expect(Object.hasOwn(first, 'arrival')).toBe(false);
  expect(Number(delayed.entity[0].tripUpdate!.stopTimeUpdate![0].departure!.time) - Number(first.departure!.time)).toBe(300);
  expect((await decode(index.snapshots.tripupdates[2].file)).entity.some(e => e.tripUpdate?.trip.scheduleRelationship === 3)).toBe(true);
  const night = await decode(index.snapshots.alerts[1].file);
  expect(Object.hasOwn(night.entity[0].alert!.activePeriod![0], 'end')).toBe(false);
});
it('reports missing snapshot references while retaining their original observation times', async () => {
  const { root, dir } = await fixture();
  const row = { at: meta.windowStart, feed: 'alerts', ok: true, epoch: Date.parse(meta.windowStart) / 1000 };
  await writeFile(join(dir, 'polls.ndjson'), JSON.stringify(row) + '\n');
  const index = await loadRecording(root, 'test');
  expect(index.diagnostics.missingSnapshots).toEqual([`${row.epoch}.alerts.pb`]);
  expect(index.observations).toEqual([row]);
});
it.each(['schedule.zip', 'polls.ndjson', 'manifest.json'])('rejects a symlink in manifest dependencies: %s', async file => {
  const { root, dir } = await fixture();
  await rm(join(dir, file)); await symlink(zipPath, join(dir, file));
  await expect(loadRecording(root, 'test')).rejects.toThrow();
});

it('publishes disk observations only after the referenced snapshot exists', async () => {
  const { root, dir, manifest } = await fixture();
  const epoch = Date.parse(meta.windowStart) / 1000;
  const observation = { at: meta.windowStart, feed: 'alerts' as const, ok: true as const, epoch };
  await expect(appendPoll(dir, manifest as ReturnType<typeof parseManifest>, observation)).rejects.toThrow();
  expect(await readFile(join(dir, 'polls.ndjson'), 'utf8')).toBe('');
  await atomicRecordingWrite(dir, `${epoch}.alerts.pb`, encodeFeed([], epoch));
  await appendPoll(dir, manifest as ReturnType<typeof parseManifest>, observation);
  const index = await loadRecording(root, 'test');
  expect(index.observations).toEqual([observation]);
  expect(index.manifest.observationEnd).toBe(meta.windowStart);
});
