#!/usr/bin/env node
// Requires Node 22.18+ (native TypeScript stripping). Never loads production .env.
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildSimConfig, composeEnvironment } from '../src/lib/sim/config.ts';
import { assertPortsAvailable, loadRun, optionalSettings, prepareRun, readCredentials, saveMarker, withRunLock } from '../src/lib/server/sim/setup.ts';
import { seedTimetable, verifySeedLegs } from '../src/lib/server/sim/seed.ts';
import { resolveSimSource, stageSimSource } from '../src/lib/server/sim/source.ts';
import { simSetup } from '../src/lib/labels.ts';

const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const [action, run, source, ...extra] = process.argv.slice(2);
if (!run || extra.length || !['start', 'status', 'stop'].includes(action) || (action === 'start' ? !source : source !== undefined)) {
  console.error(simSetup.usage); process.exit(1);
}

function docker(config, credentials, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['--context', 'default', 'compose', '--project-name', config.project,
      '--project-directory', root, '--env-file', '/dev/null', '-f', join(root, 'compose.sim.yml'), ...args], {
      cwd: root, env: { ...composeEnvironment(config, credentials, process.env),
        SIM_UID: String(process.getuid()), SIM_GID: String(process.getgid()) },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk; });
    // Do not print daemon diagnostics from captured commands: they can include expanded secrets.
    if (capture) child.stderr.resume();
    child.once('error', () => reject(new Error(simSetup.commandFailed)));
    child.once('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(simSetup.commandFailed)));
  });
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(simSetup.requestFailed(response.status));
  return response.json();
}
async function waitFor(check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  do {
    try { if (await check()) return; } catch {}
    await setTimeout(300);
  } while (Date.now() < deadline);
  throw new Error(simSetup.timeout);
}
async function authenticate(config, credentials) {
  const host = config.bindHost === '0.0.0.0' ? '127.0.0.1' : config.bindHost;
  const pb = `http://${host}:${config.pbPort}`, web = `http://${host}:${config.webPort}`;
  await waitFor(async () => { await request(`${pb}/api/health`); return true; });
  await waitFor(async () => (await fetch(`${web}/login`, { redirect: 'error', signal: AbortSignal.timeout(2000) })).ok);
  const auth = await request(`${pb}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: credentials.PB_ADMIN_EMAIL, password: credentials.PB_ADMIN_PASSWORD })
  });
  return { web, api: (method, path, body) => request(pb + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: auth.token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
}
try {
  let marker, selected;
  if (action === 'start') {
    selected = await resolveSimSource(root, source);
    const config = buildSimConfig({ root, run, source, scenario: selected.scenario,
      fixtureHash: selected.fixtureHash, settings: await optionalSettings(root) });
    marker = await prepareRun(config);
  } else marker = await loadRun(root, run);
  const config = marker.config, credentials = await readCredentials(config);
  await withRunLock(config, async () => {
    // Re-read after admission: another operation may have finished while we were loading.
    marker = await loadRun(root, run);
    if (action === 'stop') {
      await docker(config, credentials, ['down', '--timeout', '10']);
      console.log(simSetup.stopped); return;
    }
    if (action === 'status') {
      console.log(JSON.stringify({ run, phase: marker.phase, web: config.webOrigin, pocketbase: config.pbOrigin,
        itineraryId: marker.itineraryId ?? null }, null, 2));
      await docker(config, credentials, ['ps']); return;
    }
    if (marker.phase === 'seeding') throw new Error(simSetup.interruptedSeed);
    await stageSimSource(config, selected);
    const running = (await docker(config, credentials, ['ps', '--status', 'running', '--services'], true)).split('\n').filter(Boolean);
    if (running.length > 0 && (running.length !== 2 || !running.includes('web') || !running.includes('pocketbase'))) throw new Error(simSetup.partialStack);
    if (!running.length) {
      await assertPortsAvailable(config);
      await docker(config, credentials, ['up', '-d', '--build']);
    }
    const { web, api } = await authenticate(config, credentials);
    if (marker.phase === 'prepared') {
      marker.phase = 'seeding'; await saveMarker(marker);
      const seeded = await seedTimetable(api, { runId: run, ...config.scenario, recordingId: selected.recordingId }, selected.scenario,
        { crew: credentials.CREW_PASSWORD, conductor: credentials.ADMIN_PASSWORD });
      await request(`${web}/api/internal/recompute?itinerary=${seeded.itineraryId}`, {
        method: 'POST', headers: { 'X-Internal-Secret': credentials.INTERNAL_SECRET }
      });
      // Each recompute ends with an event_log row. Wait for the stop-triggered passes and the
      // explicit final pass, then inspect the persisted result rather than hand-written times.
      await waitFor(async () => {
        const filter = encodeURIComponent(`itinerary="${seeded.itineraryId}" && kind="recompute"`);
        const logs = await api('GET', `/api/collections/event_log/records?perPage=1&filter=${filter}`);
        return logs.totalItems >= selected.scenario.stops.length + 1;
      });
      const filter = encodeURIComponent(`itinerary="${seeded.itineraryId}"`);
      const legs = await api('GET', `/api/collections/legs/records?perPage=100&filter=${filter}`);
      if (!verifySeedLegs(seeded.stopIds, legs.items, config.scenario)) throw new Error(simSetup.invalidLegs);
      marker.phase = 'ready'; marker.itineraryId = seeded.itineraryId; await saveMarker(marker);
      console.log(JSON.stringify({ legs: legs.items.map(l => ({ from: l.from_stop, to: l.to_stop,
        kind: l.kind, departAt: l.depart_at, arriveAt: l.arrive_at })) }, null, 2));
    } else {
      const clock = await api('GET', '/api/collections/simulation_clock/records/simulationclock');
      if (clock.run_id !== run || clock.source !== (selected.recordingId ? 'recording' : 'timetable') ||
        (clock.recording_id || null) !== selected.recordingId || clock.service_date !== config.scenario.serviceDate ||
        Date.parse(clock.window_start) !== Date.parse(config.scenario.windowStart) ||
        Date.parse(clock.window_end) !== Date.parse(config.scenario.windowEnd)) throw new Error(simSetup.clockMismatch);
    }
    console.log(simSetup.ready);
    console.log(JSON.stringify({ web: config.webOrigin, pocketbase: config.pbOrigin, runDirectory: config.runDir }, null, 2));
    console.log(simSetup.identities); console.log(simSetup.credentials); console.log(simSetup.lanNote);
  });
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
