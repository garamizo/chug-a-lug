import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, copyFile, chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(mode?: string) {
  const root = await mkdtemp(join(tmpdir(), 'rehearsal-up-')); dirs.push(root);
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'bin'));
  await copyFile(resolve('../scripts/up.sh'), join(root, 'scripts/up.sh'));
  await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n');
  await chmod(join(root, 'bin/docker'), 0o755);
  await writeFile(join(root, 'bin/node'), '#!/bin/sh\nexit 0\n');
  await chmod(join(root, 'bin/node'), 0o755);
  return { root, run() {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH, CALLS: join(root, 'calls') };
    if (mode === undefined) delete env.REHEARSAL; else env.REHEARSAL = mode;
    return spawnSync('bash', ['scripts/up.sh'], { cwd: root, env, encoding: 'utf8' });
  }, calls: () => readFile(join(root, 'calls'), 'utf8') };
}
it('up starts the real stack only', async () => {
  const f = await fixture();
  await f.run();
  expect(await f.calls()).toBe('compose -f compose.yml up -d --build\n');
});
it('up ignores a leftover REHEARSAL setting and never touches data/rehearsal', async () => {
  const f = await fixture('1');
  await mkdir(join(f.root, 'data/rehearsal/pb_data'), { recursive: true });
  await writeFile(join(f.root, 'data/rehearsal/pb_data/keep'), 'x');
  await f.run();
  expect(await f.calls()).toBe('compose -f compose.yml up -d --build\n');
  expect(await readFile(join(f.root, 'data/rehearsal/pb_data/keep'), 'utf8')).toBe('x');
});
