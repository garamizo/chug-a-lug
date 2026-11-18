import { spawnSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
// The production shell must carry PUBLIC_SIM before it can boot without a clock response.
const env = { ...process.env, PUBLIC_SIM: '1', PUBLIC_PB_URL: 'http://127.0.0.1:18093', SIM_OFFLINE: '1' };
function run(args, extra = {}) {
  const result = spawnSync('npm', args, { env: { ...env, ...extra }, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// update.spec.ts swaps a second, marked build under the running server; build it first and park it.
rmSync('build-next', { recursive: true, force: true });
run(['run', 'build'], { VITE_BUILD_MARK: 'next' });
renameSync('build', 'build-next');
run(['run', 'build']);
run(['run', 'test:sim']);
