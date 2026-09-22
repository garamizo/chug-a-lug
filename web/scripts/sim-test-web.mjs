// Test-only supervisor: SIGUSR2 restarts web against the same disposable PocketBase.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (process.env.SIM !== '1' || process.env.PB_URL !== 'http://127.0.0.1:18093' || !process.env.SIM_WEB_CONTROL) throw new Error('Isolated simulation test configuration required');
let child, stopping = false, restarting = false, generation = 0;
function start() {
  child = spawn(process.execPath, process.argv.includes('--production') ? ['build'] : ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '15173', '--strictPort'], { stdio: 'inherit' });
  writeFileSync(process.env.SIM_WEB_CONTROL, JSON.stringify({ pid: process.pid, generation: ++generation }));
  child.on('error', () => process.exit(1));
  child.on('exit', code => {
    if (!stopping && restarting) { restarting = false; start(); }
    else process.exit(code ?? 0);
  });
}
process.on('SIGUSR2', () => { if (!stopping && !restarting) { restarting = true; child.kill('SIGTERM'); } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child.kill(signal); });
start();
