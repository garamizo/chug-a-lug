// CLI-only setup helpers. No app request imports these or provisions a rehearsal.
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rmdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { assertSameRun, buildSimConfig, runDirectory, type Credentials, type SimConfig } from '../../sim/config.ts';
import { simSetup } from '../../labels.ts';
export type RunMarker = { config: SimConfig; phase: 'prepared' | 'seeding' | 'ready'; itineraryId?: string };
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
async function realDirectory(path: string, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error(simSetup.unsafePath);
}
async function regularFile(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(simSetup.unsafePath);
}
export async function saveMarker(marker: RunMarker) {
  const path = join(marker.config.runDir, 'marker.json');
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(marker, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
export async function loadRun(root: string, run: string): Promise<RunMarker> {
  const runDir = runDirectory(root, run);
  await realDirectory(join(root, '.simulations'));
  await realDirectory(runDir);
  await regularFile(join(runDir, 'marker.json'));
  const marker = JSON.parse(await readFile(join(runDir, 'marker.json'), 'utf8')) as RunMarker;
  if (!['prepared', 'seeding', 'ready'].includes(marker.phase)) throw new Error(simSetup.runMismatch);
  const c = marker.config;
  const expected = buildSimConfig({ root, run, source: c.source, fixtureHash: c.fixtureHash, scenario: c.scenario,
    settings: { WEB_PORT: String(c.webPort), PB_PORT: String(c.pbPort), BIND_HOST: c.bindHost, WEB_ORIGIN: c.webOrigin, PB_ORIGIN: c.pbOrigin } });
  assertSameRun(expected, c);
  for (const name of ['pb', 'cache', 'fixtures']) await realDirectory(join(runDir, name));
  await regularFile(join(runDir, 'credentials.env'));
  return marker;
}
export async function prepareRun(config: SimConfig): Promise<RunMarker> {
  await realDirectory(config.root);
  await realDirectory(join(config.root, '.simulations'), true);
  let created = false;
  try { await mkdir(config.runDir, { mode: 0o700 }); created = true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  if (!created) {
    const marker = await loadRun(config.root, config.run);
    assertSameRun(config, marker.config);
    return marker;
  }
  for (const name of ['pb', 'cache', 'fixtures']) await realDirectory(join(config.runDir, name), true);
  const secret = () => randomBytes(24).toString('hex');
  const credentials: Credentials = { PB_ADMIN_EMAIL: 'rehearsal@chugalug.invalid', PB_ADMIN_PASSWORD: secret(),
    CREW_PASSWORD: secret(), ADMIN_PASSWORD: secret(), INTERNAL_SECRET: secret() };
  await writeFile(join(config.runDir, 'credentials.env'), Object.entries(credentials).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  const marker: RunMarker = { config, phase: 'prepared' };
  await saveMarker(marker);
  return marker;
}
export async function readCredentials(config: SimConfig): Promise<Credentials> {
  const path = join(config.runDir, 'credentials.env'); await regularFile(path);
  const value = parseEnv(await readFile(path, 'utf8'));
  const keys = ['PB_ADMIN_EMAIL', 'PB_ADMIN_PASSWORD', 'CREW_PASSWORD', 'ADMIN_PASSWORD', 'INTERNAL_SECRET'];
  if (Object.keys(value).length !== keys.length || value.PB_ADMIN_EMAIL !== 'rehearsal@chugalug.invalid' ||
    keys.slice(1).some(k => !/^[a-f0-9]{48}$/.test(value[k] ?? ''))) throw new Error(simSetup.invalidCredentials);
  return value as Credentials;
}
export async function withRunLock<T>(config: SimConfig, action: () => Promise<T>): Promise<T> {
  const path = join(config.runDir, '.operation-lock');
  try { await mkdir(path, { mode: 0o700 }); }
  catch { throw new Error(simSetup.locked); }
  try { return await action(); } finally { await rmdir(path); }
}
export async function assertPortsAvailable(config: SimConfig) {
  const probes: Server[] = [];
  try {
    for (const port of [config.webPort, config.pbPort]) {
      const probe = createServer(); probes.push(probe);
      await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, config.bindHost, resolve); });
    }
  } catch { throw new Error(simSetup.occupiedPort); }
  finally { await Promise.all(probes.filter(p => p.listening).map(p => new Promise<void>(resolve => p.close(() => resolve())))); }
}
export async function optionalSettings(root: string): Promise<Record<string, string | undefined>> {
  const path = join(root, '.env.sim');
  try { await regularFile(path); return parseEnv(await readFile(path, 'utf8')); }
  catch (e) { if (missing(e)) return {}; throw e; }
}
