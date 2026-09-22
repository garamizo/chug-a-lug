import { afterEach, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createReplay } from '../../src/lib/server/metra/replay';
import { readPredictions, selectAlerts } from '../../src/lib/server/metra/decode';
import { modeFor, selectDepartures } from '../../src/lib/metra/live';
import { encodeFeed, tripUpdate } from '../fixtures/rt';
const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
const source = resolve('tests/fixtures/sim');
const at = (time: string) => ({ eventNow: `2026-12-26T${time}.000Z` });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'replay-')); roots.push(root);
  const dir = join(root, 'recording'); await cp(join(source, 'recording'), dir, { recursive: true });
  return { root, dir };
}
it('selects only past data at exact boundaries, between polls, and after the tail', async () => {
  const replay = await createReplay(source, 'recording');
  expect((await replay.snapshot(at('18:19:59'))).feeds).toEqual({ positions: null, tripupdates: null, alerts: null });
  const start = await replay.snapshot(at('18:20:00'));
  expect(start.feeds.positions).toBeNull(); expect(start.status.feeds.tripupdates.ageSec).toBe(0);
  expect((await replay.snapshot(at('18:20:29'))).status.feeds.tripupdates.ageSec).toBe(29);
  const same = await replay.snapshot(at('18:20:30'));
  expect(same.status.feeds.tripupdates.ageSec).toBe(0);
  expect(Number(same.feeds.tripupdates!.message.header.timestamp)).toBe(1798309200);
  expect((await replay.snapshot({ eventNow: '2026-12-27T00:10:00Z' })).status.feeds.tripupdates.ageSec).toBe(600);
});
it('ages feeds independently, with the existing inclusive 120-second threshold', async () => {
  const replay = await createReplay(source, 'recording');
  expect(modeFor((await replay.snapshot(at('18:23:00'))).status.feeds.positions)).toBe('live');
  expect(modeFor((await replay.snapshot(at('18:23:01'))).status.feeds.positions)).toBe('stale');
  const snap = await replay.snapshot(at('18:26:01'));
  expect(snap.status.feeds.positions.ageSec).toBe(301);
  expect(modeFor(snap.status.feeds.tripupdates)).toBe('stale');
  expect(modeFor(snap.status.feeds.alerts)).toBe('live');
  expect(await replay.snapshot(at('18:26:01'))).toEqual(snap);
});
it.each(['missing', 'corrupt', 'future header'])('falls back with original age when the selected snapshot is %s', async damage => {
  const { root, dir } = await fixture(); const file = join(dir, '1798309320.tripupdates.pb');
  if (damage === 'missing') await rm(file);
  else await writeFile(file, damage === 'corrupt' ? new Uint8Array([255]) : encodeFeed([], 1798309400));
  const replay = await createReplay(root, 'recording');
  const snap = await replay.snapshot(at('18:24:00'));
  expect(snap.status.feeds.tripupdates.ageSec).toBe(180);
  expect(Number(snap.feeds.tripupdates!.message.header.timestamp)).toBe(1798309260);
  expect(snap.diagnostics.some(d => d.code === 'unreadable_snapshot')).toBe(true);
});
it('legacy freshness uses header time, never invented successful polls', async () => {
  const { root, dir } = await fixture(); const file = join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')); manifest.observationsAvailable = false;
  await writeFile(file, JSON.stringify(manifest));
  const replay = await createReplay(root, 'recording');
  const snap = await replay.snapshot(at('18:24:00'));
  expect(snap.status.feeds.tripupdates.ageSec).toBe(120);
  expect(snap.status.feeds.alerts.ageSec).toBe(240);
  expect(snap.diagnostics.some(d => d.code === 'legacy_freshness')).toBe(true);
});
it('preserves absent fields and freezes nested results across cache hits and eviction', async () => {
  const replay = await createReplay(source, 'recording', { cacheSize: 1 });
  const early = await replay.snapshot(at('18:20:00'));
  const update = early.feeds.tripupdates!.message.entity[0].tripUpdate!;
  expect(Object.hasOwn(update.stopTimeUpdate![0], 'arrival')).toBe(false);
  expect(() => { update.trip.tripId = 'changed'; }).toThrow();
  await replay.snapshot(at('18:22:00'));
  expect(await replay.snapshot(at('18:20:00'))).toEqual(early);
  expect(replay.cachedFiles()).toBeLessThanOrEqual(1);
});
it('rejects unsupported manifests and recordings with no usable BNSF coverage', async () => {
  const { root, dir } = await fixture(); const file = join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...manifest, version: 2 }));
  await expect(createReplay(root, 'recording')).rejects.toThrow();
  await writeFile(file, JSON.stringify(manifest));
  for (const epoch of [1798309200, 1798309260, 1798309320]) {
    await writeFile(join(dir, `${epoch}.tripupdates.pb`), encodeFeed([tripUpdate({ id: 'wrong', tripId: 'BN1', startDate: '20261219' })], epoch));
  }
  await expect(createReplay(root, 'recording')).rejects.toThrow();
});
it('reports and removes unmatched entities without rejecting useful coverage', async () => {
  const { root, dir } = await fixture();
  await writeFile(join(dir, '1798309200.tripupdates.pb'), encodeFeed([
    tripUpdate({ id: 'good', tripId: 'BN1', startDate: '20261226' }),
    tripUpdate({ id: 'wrong-date', tripId: 'BN3', startDate: '20261219' }),
    tripUpdate({ id: 'unknown', tripId: 'unknown' })
  ], 1798309200));
  const snap = await (await createReplay(root, 'recording')).snapshot(at('18:20:00'));
  expect(snap.feeds.tripupdates!.message.entity.map(e => e.id)).toEqual(['good']);
  expect(snap.diagnostics.filter(d => d.code === 'unmatched_trip')).toHaveLength(2);
});
it('uses existing departure and alert logic without rebasing recorded timestamps', async () => {
  const replay = await createReplay(source, 'recording');
  const snap = await replay.snapshot(at('18:22:00'));
  const preds = readPredictions(snap.feeds.tripupdates!.message, 'BNSF', '2026-12-26');
  const candidates = ['BN1', 'BN3'].map(tripId => ({ tripId, routeId: 'BNSF', headsign: 'Aurora',
    schedDepart: '2026-12-26T18:33:00Z', schedArrive: '2026-12-26T19:00:00Z',
    liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled' as const }));
  const selected = selectDepartures(candidates, preds, 'CUS', 'AURORA', new Date('2026-12-26T18:34:00Z'), 5);
  expect(selected.map(t => t.tripId)).toEqual(['BN1']); expect(selected[0].delayMin).toBe(5);
  const alerts = async (eventNow: string) => selectAlerts((await replay.snapshot({ eventNow })).feeds.alerts!.message,
    { routeId: 'BNSF', stationIds: new Set<string>(), now: new Date(eventNow) });
  expect(await alerts('2026-12-26T18:21:00Z')).toHaveLength(1);
  expect(await alerts('2026-12-26T18:22:00Z')).toHaveLength(0);
  expect(await alerts('2026-12-27T00:00:00Z')).toHaveLength(1);
});
it('fresh positions do not refresh stale trip updates, and missing alerts stay missing', async () => {
  const { root, dir } = await fixture();
  await writeFile(join(dir, 'polls.ndjson'), [
    { at: '2026-12-26T18:20:00Z', feed: 'tripupdates', ok: true, epoch: 1798309200 },
    { at: '2026-12-26T18:24:00Z', feed: 'positions', ok: true, epoch: 1798309260 }
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  const snap = await (await createReplay(root, 'recording')).snapshot(at('18:24:00'));
  expect(modeFor(snap.status.feeds.positions)).toBe('live');
  expect(modeFor(snap.status.feeds.tripupdates)).toBe('stale');
  expect(snap.feeds.alerts).toBeNull();
});
it('captures time before disk reads and isolates overlapping requests', async () => {
  const replay = await createReplay(source, 'recording', { cacheSize: 1 });
  const context = at('18:20:00');
  const pending = replay.snapshot(context); context.eventNow = at('18:24:00').eventNow;
  const [early, late] = await Promise.all([pending, replay.snapshot(context)]);
  expect(early.feeds.positions).toBeNull();
  expect(early.status.feeds.tripupdates.ageSec).toBe(0);
  expect(late.status.feeds.positions.ageSec).toBe(180);
  expect(replay.cachedFiles()).toBeLessThanOrEqual(1);
});
