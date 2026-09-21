import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSimConfig } from '../../src/lib/sim/config';
import { prepareRun, loadRun, assertPortsAvailable, withRunLock } from '../../src/lib/server/sim/setup';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function config() {
  const root = await mkdtemp(join(tmpdir(), 'sim-setup-test-')); roots.push(root);
  return buildSimConfig({ root, run: 'test', source: 'fixture', fixtureHash: 'a'.repeat(64), scenario: {
    serviceDate: '2026-12-26', startTime: '10:00', epochStart: '2026-12-26T16:00:00Z',
    windowStart: '2026-12-26T16:00:00Z', windowEnd: '2026-12-27T05:00:00Z'
  } });
}
describe('rehearsal filesystem and port isolation', () => {
  it('creates private run credentials and preserves them on resume', async () => {
    const c = await config(); await prepareRun(c);
    const credentials = await readFile(join(c.runDir, 'credentials.env'), 'utf8');
    await prepareRun(c);
    expect(await readFile(join(c.runDir, 'credentials.env'), 'utf8')).toBe(credentials);
    expect((await loadRun(c.root, c.run)).config).toEqual(c);
    expect(credentials).toContain('PB_ADMIN_EMAIL=');
  });
  it('refuses a changed fixture before touching existing data', async () => {
    const c = await config(); await prepareRun(c);
    const path = join(c.runDir, 'marker.json'), before = await readFile(path, 'utf8');
    await expect(prepareRun({ ...c, fixtureHash: 'b'.repeat(64) })).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
  });
  it('does not adopt an unowned directory', async () => {
    const c = await config(); await mkdir(c.runDir, { recursive: true });
    await writeFile(join(c.runDir, 'keep'), 'data');
    await expect(prepareRun(c)).rejects.toThrow();
    expect(await readFile(join(c.runDir, 'keep'), 'utf8')).toBe('data');
  });
  it.each(['.simulations', '.simulations/test', '.simulations/test/pb'])('rejects a symlink at %s', async path => {
    const c = await config(), target = join(c.root, 'outside'); await mkdir(target);
    if (path.endsWith('/pb')) await prepareRun(c);
    else if (path.includes('/')) await mkdir(join(c.root, '.simulations'));
    const link = join(c.root, path);
    if (path.endsWith('/pb')) await rm(link, { recursive: true });
    await symlink(target, link);
    await expect(prepareRun(c)).rejects.toThrow();
  });
  it('rejects concurrent setup and releases the lock on failure', async () => {
    const c = await config(); await prepareRun(c);
    await expect(withRunLock(c, async () => {
      await expect(withRunLock(c, async () => undefined)).rejects.toThrow();
      throw new Error('operation failed');
    })).rejects.toThrow('operation failed');
    await expect(withRunLock(c, async () => 'ready')).resolves.toBe('ready');
  });
  it('refuses an occupied port without contacting its server', async () => {
    const c = await config(), server = createServer(() => { throw new Error('must not connect'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try { await expect(assertPortsAvailable({ ...c, webPort: port })).rejects.toThrow(); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
