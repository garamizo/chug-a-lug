import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:net';

// Separate disposable databases prove normal-mode isolation and simulation event hooks.
for (const sim of [false, true]) {
  process.env.SIM = sim ? '1' : '0';
  process.env.SIM_RUN_ID = sim ? 'hook-fixture' : '';
  // Refuse to connect tests to any pre-existing server.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(18090, '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
  process.env.WEB_INTERNAL_URL = 'http://127.0.0.1:18095';
  process.env.INTERNAL_SECRET = 'hooks-test-secret';
  const server = spawn(process.execPath, ['scripts/pb-test-server.mjs', '18090'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const serverExit = once(server, 'exit');
  let test;
  const stop = (signal) => { test?.kill(signal); server.kill(signal); };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error('Test PocketBase exited during startup');
      try { healthy = (await fetch('http://127.0.0.1:18090/api/health')).ok; } catch {}
      if (healthy) break;
      await setTimeout(200);
    }
    if (!healthy) throw new Error('Test PocketBase did not become healthy');
    test = spawn('npm', sim ? ['exec', '--', 'vitest', 'run', 'tests/hooks/simulationEvents.test.ts'] : ['run', 'test:hooks'], {
      cwd: 'web', stdio: 'inherit', env: {
        ...process.env, PB_URL: 'http://127.0.0.1:18090', PB_ADMIN_EMAIL: 'tests@chugalug.invalid',
        PB_ADMIN_PASSWORD: 'local-test-password-only', CREW_PASSWORD: 'crew-test-password', ADMIN_PASSWORD: 'admin-test-password'
      }
    });
    const [code] = await once(test, 'exit');
    process.exitCode = code ?? 1;
  } finally {
    server.kill('SIGTERM');
    await serverExit;
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
  if (process.exitCode) break;
}
