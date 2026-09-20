// Fetch-once: Google details and up to five photos per place_id, stored under data/places/<place_id>/
// and mirrored into stop_photos so every phone gets the same card.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { serverEnv } from '$lib/server/env';
import { adminPb } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { exists, readJson, writeBytes, writeJson } from './cache';
import { consumeBudget } from './budget';
import { photoBytes, placeDetails, searchText, type PlaceMeta } from './google';
import type { AttachResult, Stop } from '$lib/types';

const DETAILS_LIMIT = 800;
const PHOTOS_LIMIT = 800;

// Serialized per stop id so two concurrent attach calls for the same stop cannot both see no
// existing photos and both create stop_photos records; the second call waits for the first and
// then re-reads the stop, so it returns 'done' immediately (same promise-queue pattern as
// recomputeItinerary in $lib/server/recompute.ts).
const queues = new Map<string, Promise<AttachResult>>();

export function attachPlace(stopId: string): Promise<AttachResult> {
  const prev = queues.get(stopId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => doAttachPlace(stopId));
  queues.set(stopId, run);
  run.finally(() => { if (queues.get(stopId) === run) queues.delete(stopId); });
  return run;
}

async function doAttachPlace(stopId: string): Promise<AttachResult> {
  const pb = await adminPb();
  const stop = await pb.collection('stops').getOne<Stop>(stopId);
  const fail = async (message: string): Promise<AttachResult> => {
    await pb.collection('stops').update(stop.id, { photos_status: 'failed' });
    return { status: 'failed', photos: 0, message };
  };
  if (!serverEnv.googleKey) return fail('Google Places is not configured on the server.');
  const cfg = { key: serverEnv.googleKey };
  const existing = await pb.collection('stop_photos').getFullList({ filter: pb.filter('stop = {:id} && source = "google"', { id: stop.id }), fields: 'id' });
  if (stop.photos_status === 'done' && existing.length) return { status: 'done', photos: existing.length };
  await pb.collection('stops').update(stop.id, { photos_status: 'pending' });
  try {
    let placeId = stop.place_id;
    if (!placeId) {
      const s = await metra.getSchedule();
      const station = s.stations.get(stop.station_id);
      const bias = { lat: stop.lat || station?.lat || 41.88, lon: stop.lon || station?.lon || -87.64, radiusM: 1500 };
      const hit = (await searchText(cfg, `${stop.name} ${stop.station_name || station?.name || ''}`.trim(), bias))[0];
      if (!hit) return fail('Google has no match for this name near the station.');
      placeId = hit.id;
    }
    const dir = join(serverEnv.dataDir, 'places', placeId);
    let meta = await readJson<PlaceMeta>(join(dir, 'meta.json'));
    if (!meta) {
      if (!(await consumeBudget(serverEnv.dataDir, 'details', DETAILS_LIMIT))) return fail('Monthly Google budget reached.');
      meta = await placeDetails(cfg, placeId);
      await writeJson(join(dir, 'meta.json'), meta);
    }
    const files: { path: string; attribution: string }[] = [];
    let budgetBlocked = false;
    for (const [i, photo] of meta.photos.entries()) {
      const path = join(dir, `${i + 1}.jpg`);
      if (!(await exists(path))) {
        if (!(await consumeBudget(serverEnv.dataDir, 'photos', PHOTOS_LIMIT))) { budgetBlocked = true; break; }
        await writeBytes(path, await photoBytes(cfg, photo.name));
      }
      files.push({ path, attribution: photo.attribution });
    }
    // The budget can stop the batch before any photo for this attach was obtained; treat that
    // like the details-budget case rather than finishing 'done' with zero photos. If at least one
    // photo made it through before the budget ran out, finishing 'done' with those is fine.
    if (budgetBlocked && files.length === 0) return fail('Monthly Google budget reached.');
    // Re-fetch existing immediately before creating records: a second guard against a concurrent
    // attach for the same stop (the per-stop queue above is the primary guard).
    const current = await pb.collection('stop_photos').getFullList({ filter: pb.filter('stop = {:id} && source = "google"', { id: stop.id }), fields: 'id' });
    if (!current.length) {
      for (const [i, f] of files.entries()) {
        const form = new FormData();
        form.set('stop', stop.id);
        form.set('source', 'google');
        form.set('attribution', f.attribution ? `Photo by ${f.attribution} via Google` : 'Photo via Google');
        form.set('file', new File([await readFile(f.path)], `${i + 1}.jpg`, { type: 'image/jpeg' }));
        await pb.collection('stop_photos').create(form);
      }
    }
    await pb.collection('stops').update(stop.id, {
      place_id: placeId,
      address: meta.address || stop.address,
      hours: meta.hours.length ? { source: 'google', weekday: meta.hours } : stop.hours,
      phone: stop.phone || meta.phone,
      website: stop.website || meta.website,
      lat: stop.lat || meta.lat,
      lon: stop.lon || meta.lon,
      photos_status: 'done'
    });
    return { status: 'done', photos: files.length };
  } catch (err) {
    console.error('[places] attach failed for', stop.id, err);
    return fail((err as Error).message);
  }
}
