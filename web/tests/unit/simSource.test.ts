import { afterEach, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSimSource, stageSimSource } from '../../src/lib/server/sim/source';
import { buildSimConfig } from '../../src/lib/sim/config';
import { prepareRun } from '../../src/lib/server/sim/setup';
const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
const checkout = resolve('..');
it('keeps the timetable fixture and adds a recording fixture on its original date', async () => {
  const timetable = await resolveSimSource(checkout, 'fixture');
  expect(timetable.recordingId).toBeNull(); expect(timetable.scenario.stops).toHaveLength(3);
  const recording = await resolveSimSource(checkout, 'fixture-recording');
  expect(recording.recordingId).toBe('recording');
  expect(recording.scenario.serviceDate).toBe('2026-12-26');
  expect(recording.scenario.windowStart).toBe('2026-12-26T18:20:00.000Z');
  expect(recording.scenario.stops).toHaveLength(2);
  expect(recording.fixtureHash).toBe((await resolveSimSource(checkout, 'fixture-recording')).fixtureHash);
});
it('resolves real recording IDs under data/recordings and rejects traversal, missing data and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sim-source-')); roots.push(root);
  await mkdir(join(root, 'data/recordings'), { recursive: true });
  await cp(resolve('tests/fixtures/sim/recording'), join(root, 'data/recordings/recording'), { recursive: true });
  expect((await resolveSimSource(root, 'recording')).recordingId).toBe('recording');
  for (const id of ['../recording', 'absent', '/tmp/source']) await expect(resolveSimSource(root, id)).rejects.toThrow();
  await symlink(join(root, 'data/recordings/recording'), join(root, 'data/recordings/alias'));
  await expect(resolveSimSource(root, 'alias')).rejects.toThrow();
});
it('stages an isolated verified archive and refuses changed or symlinked content on resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sim-source-')); roots.push(root);
  const source = await resolveSimSource(checkout, 'fixture-recording');
  const config = buildSimConfig({ root, run: 'test', source: 'fixture-recording', ...source });
  await prepareRun(config); await stageSimSource(config, source); await stageSimSource(config, source);
  const file = join(config.runDir, 'fixtures/recording/schedule.zip');
  expect((await readFile(file)).length).toBeGreaterThan(0);
  await writeFile(file, 'changed'); await expect(stageSimSource(config, source)).rejects.toThrow();
  await rm(file); await symlink(resolve('tests/fixtures/gtfs.zip'), file);
  await expect(stageSimSource(config, source)).rejects.toThrow();
});
it('rejects an archive whose usable trip snapshots are unreachable from its poll history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sim-source-')); roots.push(root);
  const dir = join(root, 'data/recordings/recording');
  await mkdir(join(root, 'data/recordings'), { recursive: true });
  await cp(resolve('tests/fixtures/sim/recording'), dir, { recursive: true });
  await writeFile(join(dir, 'polls.ndjson'), JSON.stringify({ at: '2026-12-26T18:20:00Z', feed: 'tripupdates', ok: false }) + '\n');
  await expect(resolveSimSource(root, 'recording')).rejects.toThrow();
});
