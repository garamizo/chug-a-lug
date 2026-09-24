#!/usr/bin/env node
// One-time canned practice route: a realistic BNSF out-and-back with bars, a lunch stop and a
// deep-dish dinner. Run once against the real stack, from web/: `just practice-route` (which is
// `node --env-file=../.env scripts/practice-route.mjs`). See docs/superpowers/specs/
// 2026-09-24-practice-days-design.md, "The canned route".
//
// Safety: this script authenticates as superuser, spends Google Places budget and writes to
// production PocketBase. It must never run as part of an automated test.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSchedule, servicesOn, unzipGtfs } from '../src/lib/metra/gtfs.ts';
import { todayInTz } from '../src/lib/time.ts';
import { CANNED_TITLE, PLAN, nextFreeSaturday, pickBar, pickDeepDish, pickLunch, placesClient } from './practice-venues.mjs';
import { CannedRouteError, buildCannedRoute } from './practice-build.mjs';

// --- Step 1: refuse before any network I/O unless the environment is complete. ---
export function requiredEnv(vars = process.env) {
  const missing = ['PB_ADMIN_EMAIL', 'PB_ADMIN_PASSWORD', 'GOOGLE_PLACES_KEY'].filter((k) => !vars[k]);
  if (missing.length) {
    throw new Error(`practice-route needs ${missing.join(', ')} set (see .env). Refusing before any network access.`);
  }
  return { pbUrl: vars.PB_URL || 'http://127.0.0.1:8090', pbAdminEmail: vars.PB_ADMIN_EMAIL,
    pbAdminPassword: vars.PB_ADMIN_PASSWORD, googlePlacesKey: vars.GOOGLE_PLACES_KEY };
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`PocketBase HTTP ${response.status} for ${url}: ${await response.text().catch(() => '')}`);
  return response.status === 204 ? null : response.json();
}

async function pocketbaseApi(pbUrl, email, password) {
  const auth = await request(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password })
  });
  const token = auth.token;
  const json = (method, path, body) => request(pbUrl + path, { method,
    headers: { 'Content-Type': 'application/json', Authorization: token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    token,
    async list(collection, predicate) {
      const rows = await request(`${pbUrl}/api/collections/${collection}/records?perPage=200`, { headers: { Authorization: token } });
      return (rows.items ?? []).filter(predicate);
    },
    async create(collection, body) {
      if (collection === 'places' && body.photos?.length) {
        const form = new FormData();
        for (const [key, value] of Object.entries(body)) {
          if (key === 'photos') continue;
          if (value === undefined || value === null) continue;
          form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        for (const photo of body.photos) {
          form.append('photos', new Blob([await readFile(photo.path)], { type: 'image/jpeg' }), photo.file);
        }
        const response = await fetch(`${pbUrl}/api/collections/places/records`, { method: 'POST', headers: { Authorization: token }, body: form, redirect: 'error', signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`PocketBase HTTP ${response.status} creating places: ${await response.text().catch(() => '')}`);
        return response.json();
      }
      return json('POST', `/api/collections/${collection}/records`, body);
    },
    async update(collection, id, body) { return json('PATCH', `/api/collections/${collection}/records/${id}`, body); },
    async remove(collection, id) { return json('DELETE', `/api/collections/${collection}/records/${id}`); },
    async getSettings() { return json('GET', '/api/collections/crawl_settings/records/crawlsettings'); },
    async setCurrent(id) { await json('PATCH', '/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: id }); }
  };
}

async function main() {
  const { pbUrl, pbAdminEmail, pbAdminPassword, googlePlacesKey } = requiredEnv();
  const api = await pocketbaseApi(pbUrl, pbAdminEmail, pbAdminPassword);

  // Refuse early, before spending Places budget, if a locked canned route already exists. A draft
  // with this title is a failed earlier run; buildCannedRoute replaces it.
  const existing = await api.list('itineraries', (r) => r.title === CANNED_TITLE);
  if (existing.some((r) => r.status === 'locked')) {
    throw new Error(`A locked canned route ("${CANNED_TITLE}") already exists. Refusing to spend Places budget.`);
  }

  // Step 2: load the station list from the cached GTFS zip.
  const gtfsDir = join(import.meta.dirname, '..', '..', 'data', 'gtfs');
  const zipName = (await readdir(gtfsDir).catch(() => [])).filter((f) => f.endsWith('.zip')).sort().at(-1);
  if (!zipName) throw new Error(`No GTFS zip found in ${gtfsDir}. Run the app once to download the timetable.`);
  const bytes = new Uint8Array(await readFile(join(gtfsDir, zipName)));
  const schedule = buildSchedule(unzipGtfs(bytes), todayInTz());

  const stationIds = [...new Set(PLAN.map((p) => p.station))];
  const stationsById = new Map();
  for (const id of stationIds) {
    const station = schedule.stations.get(id);
    if (!station) throw new Error(`Missing station ${id} in the cached timetable.`);
    stationsById.set(id, station);
  }

  // Step 4: the next Saturday not already used by a locked route, and covered by the timetable.
  const lockedDates = (await api.list('itineraries', (r) => r.status === 'locked')).map((r) => r.event_date);
  let eventDate = todayInTz();
  let covered = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    eventDate = nextFreeSaturday(eventDate, lockedDates);
    const active = servicesOn(schedule, eventDate);
    if (schedule.trips.some((t) => t.routeId === 'BNSF' && active.has(t.serviceId))) { covered = true; break; }
  }
  if (!covered) throw new Error('The timetable does not cover the next Saturdays.');

  // Step 3: pick venues in PLAN order, one `used` set, caching raw Places JSON and photos.
  const directory = join(import.meta.dirname, '..', '..', 'data', 'practice-route');
  await mkdir(directory, { recursive: true });
  const client = placesClient(googlePlacesKey);
  const used = new Set();
  const metres = (p, s) => Math.hypot((p.location.latitude - s.lat) * 111000, (p.location.longitude - s.lon) * 83000);

  async function cached(name, fetcher) {
    const file = join(directory, `${name}.json`);
    const found = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
    if (found) return found;
    const result = await fetcher();
    await writeFile(file, JSON.stringify(result, null, 2));
    return result;
  }

  async function downloadPhotos(prefix, place) {
    const detail = await client.details(place.id);
    const photos = [];
    for (const [i, photo] of (detail.photos ?? []).slice(0, 2).entries()) {
      const filename = `${prefix}-${i}.jpg`;
      await client.photo(photo.name, directory, filename);
      photos.push({ file: filename, path: join(directory, filename), attribution: (photo.authorAttributions ?? []).map((a) => a.displayName).join(', ') });
    }
    return { detail, photos };
  }

  function stopFields(place, detail, photos, plan, station) {
    return {
      name: detail.displayName?.text ?? place.displayName?.text, kind: plan.role === 'lunch' || plan.role === 'dinner' ? 'restaurant' : 'bar',
      station_id: plan.station, station_name: station.name, dwell_min: plan.dwell,
      direction: plan.direction === 'in' ? 'back' : 'out', // stops.direction is out/back; PLAN's out/in maps onto it.
      place_id: place.id, address: detail.formattedAddress, lat: detail.location.latitude, lon: detail.location.longitude,
      hours: { source: 'google', weekday: detail.regularOpeningHours?.weekdayDescriptions ?? [] },
      rating: detail.rating, rating_count: detail.userRatingCount, phone: detail.nationalPhoneNumber,
      website: detail.websiteUri, maps_url: detail.googleMapsUri, photos, photo_attributions: photos.map((p) => p.attribution),
      reviews: (detail.reviews ?? []).slice(0, 3).map((r) => ({ text: r.text?.text ?? '', author: r.authorAttribution?.displayName ?? '', url: r.googleMapsUri ?? '', rating: r.rating })),
      fetched_at: new Date().toISOString(),
      walk_min: Math.max(2, Math.round(metres(place, station) / 80))
    };
  }

  const stopList = [];
  const deepDishCandidates = {};
  for (const plan of PLAN) {
    const station = stationsById.get(plan.station);
    if (plan.role === 'dinner') continue; // resolved after the outbound loop, across stations.
    const nearby = await cached(`${plan.station}-search`, () => client.searchNearby(station, 1000, ['bar', 'pub', 'brewery', 'restaurant']));
    const picked = plan.role === 'lunch' ? pickLunch(nearby, station, used) : pickBar(nearby, station, used);
    if (!picked) throw new Error(`No usable ${plan.role} venue near ${plan.station}.`);
    used.add(picked.id);
    const { detail, photos } = await downloadPhotos(`${plan.station}-${plan.role}`, picked);
    stopList.push({ plan, fields: stopFields(picked, detail, photos, plan, station) });
    if (plan.direction === 'out') {
      deepDishCandidates[plan.station] = await cached(`${plan.station}-deepdish`, () => client.searchText('deep dish pizza', station, 1500));
    }
  }
  const dinnerPlan = PLAN.find((p) => p.role === 'dinner');
  const deepDish = pickDeepDish(deepDishCandidates, used);
  if (!deepDish) throw new Error('No walkable deep-dish pizza place found near any outbound station.');
  used.add(deepDish.place.id);
  const dinnerStation = stationsById.get(deepDish.station);
  if (deepDish.station !== dinnerPlan.station) {
    console.log(`Deep dish: moving dinner from ${dinnerPlan.station} to ${deepDish.station} (best-rated result).`);
  }
  const { detail: dinnerDetail, photos: dinnerPhotos } = await downloadPhotos(`${deepDish.station}-dinner`, deepDish.place);
  const dinnerFields = stopFields(deepDish.place, dinnerDetail, dinnerPhotos, dinnerPlan, dinnerStation);
  // Keep dinner's position in PLAN order (it stays the 8th stop) even though its station changed.
  const dinnerIndex = PLAN.indexOf(dinnerPlan);
  stopList.splice(dinnerIndex, 0, { plan: dinnerPlan, fields: dinnerFields });

  const stops = stopList.map(({ fields }) => fields);

  const admins = await api.list('users', (u) => u.is_admin);
  if (!admins.length) throw new Error('No admin user found; the canned route needs an owner.');
  const ownerId = admins[0].id;

  try {
    const { id } = await buildCannedRoute(api, stops, { title: CANNED_TITLE, eventDate, startTime: '11:00', ownerId, timeoutMs: 60_000, pollMs: 1_000 });
    console.log(`Built ${CANNED_TITLE} (${id}) for ${eventDate}:`);
    for (const stop of stops) console.log(`  ${stop.direction === 'back' ? 'in ' : 'out'} ${stop.station_id.padEnd(10)} ${stop.kind.padEnd(10)} ${stop.name}`);
  } catch (error) {
    if (error instanceof CannedRouteError) { console.error(error.message); process.exitCode = 1; return; }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
