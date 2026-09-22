import { spawnSync } from 'node:child_process';
// The production shell must carry PUBLIC_SIM before it can boot without a clock response.
const env = { ...process.env, PUBLIC_SIM: '1', PUBLIC_PB_URL: 'http://127.0.0.1:18093', SIM_OFFLINE: '1' };
for (const args of [['run', 'build'], ['run', 'test:sim']]) {
  const result = spawnSync('npm', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
