import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, copyFile, chmod, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rehearsal-up-')); dirs.push(root);
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'bin'));
  await copyFile(resolve('../scripts/up.sh'), join(root, 'scripts/up.sh'));
  await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n');
  await chmod(join(root, 'bin/docker'), 0o755);
  await writeFile(join(root, 'bin/node'), '#!/bin/sh\nexit 0\n');
  await chmod(join(root, 'bin/node'), 0o755);
  return { root, run(mode?: string) {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: join(root, 'bin') + ':' + process.env.PATH, CALLS: join(root, 'calls') };
    delete env.REHEARSAL; if (mode !== undefined) env.REHEARSAL = mode;
    return spawnSync('bash', ['scripts/up.sh'], { cwd: root, env, encoding: 'utf8' });
  }, calls: () => readFile(join(root, 'calls'), 'utf8') };
}
it('regular up defaults to rehearsal and initializes it automatically', async () => {
  const f = await fixture(); expect(f.run().status).toBe(0);
  expect(await f.calls()).toBe('compose -f compose.yml -f compose.rehearsal.yml down\ncompose -f compose.yml -f compose.rehearsal.yml up -d --build\ncompose -f compose.yml -f compose.rehearsal.yml run --build --rm --no-deps rehearsal-init\n');
});
it('explicit live startup does not initialize or mount the rehearsal overlay', async () => {
  const f = await fixture(); expect(f.run('0').status).toBe(0);
  expect(await f.calls()).toBe('compose -f compose.yml up -d --build\n');
});
it('invalid startup modes never invoke Docker', async () => {
  const f = await fixture(); expect(f.run('false').status).toBe(1); expect(f.run('').status).toBe(1);
  await expect(f.calls()).rejects.toThrow();
});
it('refuses a rehearsal data symlink before starting services', async () => {
  const f = await fixture(); await mkdir(join(f.root, 'data')); await mkdir(join(f.root, 'production'));
  await symlink(join(f.root, 'production'), join(f.root, 'data/rehearsal'));
  expect(f.run().status).toBe(1); await expect(f.calls()).rejects.toThrow();
});

it('restart deletes rehearsal uploads, logins and routes while preserving real event data', async () => {
  const f = await fixture();
  await mkdir(join(f.root, 'data/rehearsal/pb_data/storage'), { recursive: true });
  await writeFile(join(f.root, 'data/rehearsal/pb_data/storage/photo.jpg'), 'old photo');
  await writeFile(join(f.root, 'data/rehearsal/pb_data/data.db'), 'old users and routes');
  await writeFile(join(f.root, 'data/rehearsal/initialized.json'), '{}');
  await mkdir(join(f.root, 'data/pb_data'), { recursive: true });
  await writeFile(join(f.root, 'data/pb_data/data.db'), 'real');
  expect(f.run().status).toBe(0);
  await expect(readFile(join(f.root, 'data/rehearsal/pb_data/data.db'))).rejects.toThrow();
  await expect(readFile(join(f.root, 'data/rehearsal/pb_data/storage/photo.jpg'))).rejects.toThrow();
  expect(await readFile(join(f.root, 'data/pb_data/data.db'), 'utf8')).toBe('real');
});

it('failed source preparation leaves existing rehearsal data and services intact', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'bin/node'), '#!/bin/sh\nexit 1\n');
  await mkdir(join(f.root, 'data/rehearsal/pb_data'), { recursive: true });
  await writeFile(join(f.root, 'data/rehearsal/pb_data/data.db'), 'practice');
  expect(f.run().status).toBe(1);
  await expect(f.calls()).rejects.toThrow();
  expect(await readFile(join(f.root, 'data/rehearsal/pb_data/data.db'), 'utf8')).toBe('practice');
});
