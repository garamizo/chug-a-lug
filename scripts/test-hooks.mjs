import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

// Both passes start PocketBase at once: fetch the binary first so they never download it together.
if (!existsSync('pocketbase/pocketbase') && spawnSync('bash', ['scripts/pb-download.sh'], { stdio: 'inherit' }).status !== 0) {
  throw new Error('PocketBase download failed');
}

const fakes = spawn(process.execPath, ['web/scripts/test-fakes.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
for (let attempt = 0; ; attempt++) {
  try { if ((await fetch('http://127.0.0.1:12526/health')).ok) break; } catch {}
  if (attempt > 50) throw new Error('Test fakes did not start');
  await setTimeout(100);
}

// Every running child, so one failing pass or a signal stops them all.
const stops = [];
let aborted = false;   // set once anything stops the run, so a pass still starting up gives up too
const stopAll = (signal) => { aborted = true; for (const stop of stops) stop(signal); };
const interrupt = () => stopAll('SIGINT'), terminate = () => stopAll('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

// Separate disposable databases prove normal-mode isolation and simulation event hooks. The two
// passes run at once: the SIM pass's two files use no mail, no boarding and no truncation.
async function pass(sim, port) {
  const env = {
    ...process.env, SIM: sim ? '1' : '0', SIM_RUN_ID: sim ? 'hook-fixture' : '',
    // The SIM pass's recompute hook must not reach recompute.test's listener on 18095: port 9 refuses at once.
    WEB_INTERNAL_URL: sim ? 'http://127.0.0.1:9' : 'http://127.0.0.1:18095', INTERNAL_SECRET: 'hooks-test-secret'
  };
  // Refuse to connect tests to any pre-existing server.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => probe.close(resolve));
  if (aborted) throw new Error(`Pass on ${port} stopped before it started`);
  const server = spawn(process.execPath, ['scripts/pb-test-server.mjs', String(port)], { stdio: ['ignore', 'ignore', 'inherit'], env });
  const serverExit = once(server, 'exit');
  let test;
  // npm runs vitest as a grandchild: kill the test's whole process group, not just npm.
  stops.push((signal) => { try { if (test) process.kill(-test.pid, signal); } catch {} server.kill(signal); });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Test PocketBase on ${port} exited during startup`);
      try { healthy = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
      if (healthy) break;
      await setTimeout(200);
    }
    if (!healthy) throw new Error(`Test PocketBase on ${port} did not become healthy`);
    if (aborted) throw new Error(`Pass on ${port} stopped before its tests ran`);
    test = spawn('npm', sim ? ['exec', '--', 'vitest', 'run', 'tests/hooks/simulationEvents.test.ts', 'tests/hooks/rehearsalLogin.test.ts'] : ['run', 'test:hooks'], {
      cwd: 'web', stdio: 'inherit', detached: true, env: {
        ...env, PB_URL: `http://127.0.0.1:${port}`, PB_ADMIN_EMAIL: 'tests@chugalug.invalid',
        PB_ADMIN_PASSWORD: 'local-test-password-only', CREW_PASSWORD: 'crew-test-password', ADMIN_PASSWORD: 'admin-test-password',
        CONDUCTOR_EMAIL: 'conductor@test.invalid', MAIL_SINK_URL: 'http://127.0.0.1:12526'
      }
    });
    const [code] = await once(test, 'exit');
    return code ?? 1;
  } finally {
    server.kill('SIGTERM');
    await serverExit;
  }
}

try {
  // Either pass failing (to start, or its tests) stops the other at once: the run has failed anyway.
  const failFast = (p) => p.then((code) => { if (code !== 0) stopAll('SIGTERM'); return code; },
    (error) => { stopAll('SIGTERM'); throw error; });
  const results = await Promise.allSettled([failFast(pass(false, 18090)), failFast(pass(true, 18091))]);
  // One pass failing to start must not leave the other running: report it, then stop everything.
  for (const r of results) if (r.status === 'rejected') console.error(r.reason);
  process.exitCode = results.every((r) => r.status === 'fulfilled' && r.value === 0) ? 0 : 1;
} finally {
  stopAll('SIGTERM');
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  fakes.kill('SIGTERM');
}
