import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:net';

// Refuse to connect tests to any pre-existing server.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(18090, '127.0.0.1', resolve);
});
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, ['scripts/pb-test-server.mjs', '18090'], { stdio: ['ignore', 'ignore', 'inherit'] });
const serverExit = once(server, 'exit');
let test;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { test?.kill(signal); server.kill(signal); });
try {
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Test PocketBase exited during startup');
    try { healthy = (await fetch('http://127.0.0.1:18090/api/health')).ok; } catch {}
    if (healthy) break;
    await setTimeout(200);
  }
  if (!healthy) throw new Error('Test PocketBase did not become healthy');
  test = spawn('npm', ['run', 'test:hooks'], {
    cwd: 'web', stdio: 'inherit', env: {
      ...process.env, PB_URL: 'http://127.0.0.1:18090', PB_ADMIN_EMAIL: 'tests@chugalug.invalid',
      PB_ADMIN_PASSWORD: 'local-test-password-only', OTP_DEV_CODE: '000000'
    }
  });
  const [code] = await once(test, 'exit');
  process.exitCode = code ?? 1;
} finally {
  server.kill('SIGTERM');
  await serverExit;
}
