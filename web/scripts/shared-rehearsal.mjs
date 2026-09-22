// Executed only by the regular stack's one-shot rehearsal-init service, on Node 22 in Docker.
import { readFile, writeFile, rename, mkdir, rmdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { initializeRehearsal } from '../src/lib/server/sim/shared.ts';
import { verifySeedLegs } from '../src/lib/server/sim/seed.ts';
import { copy } from '../src/lib/labels.ts';
if (process.env.SIM !== '1' || process.env.PB_URL !== 'http://pocketbase:8090' || process.env.WEB_INTERNAL_URL !== 'http://web:3000') throw new Error(copy.simDisabled);
const scenario = JSON.parse(await readFile('/app/rehearsal/scenario.json', 'utf8'));
const state = '/state/initialized.json', lock = '/state/setup.lock';
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Rehearsal setup HTTP ${response.status}`);
  return response.json();
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check().catch(() => false)) return;
    await setTimeout(500);
  }
  throw new Error(copy.simUnavailable);
}
await mkdir(lock); // One initializer; never delete someone else's lock or partially seeded data.
try {
  await waitFor(async () => (await fetch('http://web:3000/login')).ok);
  const auth = await request('http://pocketbase:8090/api/collections/_superusers/auth-with-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD })
  });
  const api = (method, path, body) => request('http://pocketbase:8090' + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: auth.token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  await initializeRehearsal({ request: api, scenario,
    passwords: { crew: process.env.CREW_PASSWORD, conductor: process.env.ADMIN_PASSWORD },
    async readMarker() {
      try { return JSON.parse(await readFile(state, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async writeMarker(marker) { await writeFile(state + '.tmp', JSON.stringify(marker), { mode: 0o600 }); await rename(state + '.tmp', state); },
    async finish(itineraryId, stopIds) {
      await request(`http://web:3000/api/internal/recompute?itinerary=${itineraryId}`, { method: 'POST', headers: { 'X-Internal-Secret': process.env.INTERNAL_SECRET } });
      await waitFor(async () => {
        const rows = await api('GET', '/api/collections/legs/records?perPage=100&filter=' + encodeURIComponent(`itinerary="${itineraryId}"`));
        return verifySeedLegs(stopIds, rows.items, scenario);
      });
    }
  });
  console.log(copy.rehearsalReady);
} finally { await rmdir(lock); }
