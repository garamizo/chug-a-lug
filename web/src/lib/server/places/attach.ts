// Fetch-once: Google details and up to five photos per venue, stored on the venue's `places`
// record and shared by every stop that points at it. A stop attach links the stop to its place,
// fills in whatever the place already has, and only calls Google for what the place lacks.
import { error } from '@sveltejs/kit';
import { serverEnv } from '$lib/server/env';
import { adminPb } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { consumeBudget } from './budget';
import { photoBytes, placeDetails, searchText } from './google';
import { findPlace } from './store';
import type PocketBase from 'pocketbase';
import type { AttachResult, Itinerary, Place, Stop } from '$lib/types';

/** Who asked for the attach. Optional so tests (and future server jobs) can skip the check. */
export type AttachCaller = { id: string; is_admin: boolean };

const DETAILS_LIMIT = 800;
const PHOTOS_LIMIT = 800;

// Serialized per stop id so two concurrent attach calls for the same stop cannot interleave; and
// per place ref so two stops sharing a venue cannot both fetch its details and photos. Same
// promise-queue pattern as recomputeItinerary in $lib/server/recompute.ts.
const stopQueues = new Map<string, Promise<unknown>>();
const placeQueues = new Map<string, Promise<unknown>>();

function serialize<T>(queues: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  queues.set(key, run);
  // `run.catch(...)` marks `run` itself as handled; the derived promise never rejects, so the
  // `.finally` bookkeeping cannot surface as an unhandled rejection and kill the Node server.
  void run
    .catch((err) => { console.error('[places] attach', key, err); })
    .finally(() => { if (queues.get(key) === run) queues.delete(key); });
  return run;
}

type PlaceSeed = { name: string; kind: string; lat: number; lon: number; address: string; station_id: string };

/** Details and up to five photos for one Google venue, once. Returns the place, or why not. */
async function ensurePlaceMedia(pb: PocketBase, cfg: { key: string }, placeId: string, seed: PlaceSeed): Promise<Place | string> {
  const ref = `google:${placeId}`;
  return serialize(placeQueues, ref, async (): Promise<Place | string> => {
    // Re-read inside the queue: a caller that waited in line must see what the one before it
    // fetched, never a copy taken before it queued.
    let p = await findPlace(pb, ref);
    if (!p) {
      p = await pb.collection('places').create<Place>({
        ref, source: 'google', place_id: placeId, name: seed.name, kind: seed.kind,
        lat: seed.lat, lon: seed.lon, address: seed.address, station_id: seed.station_id, fetched_at: new Date().toISOString()
      });
    }
    if (!p.details_at) {
      if (!(await consumeBudget(serverEnv.dataDir, 'details', DETAILS_LIMIT))) return 'Monthly Google budget reached.';
      const meta = await placeDetails(cfg, placeId);
      p = await pb.collection('places').update<Place>(p.id, {
        name: meta.name || p.name, address: meta.address || p.address, lat: meta.lat || p.lat, lon: meta.lon || p.lon,
        hours: meta.hours.length ? { source: 'google', weekday: meta.hours } : p.hours,
        rating: meta.rating ?? p.rating, phone: meta.phone || p.phone, website: meta.website || p.website, maps_url: meta.mapsUrl,
        photo_refs: meta.photos.map((ph) => ph.name), photo_attributions: meta.photos.map((ph) => ph.attribution),
        details_at: new Date().toISOString()
      });
    }
    const refs = p.photo_refs ?? [];
    if (!p.photos.length && refs.length) {
      const form = new FormData();
      let got = 0, blocked = false;
      for (const [i, name] of refs.entries()) {
        if (!(await consumeBudget(serverEnv.dataDir, 'photos', PHOTOS_LIMIT))) { blocked = true; break; }
        const bytes = await photoBytes(cfg, name);
        form.append('photos', new File([bytes.slice().buffer as ArrayBuffer], `${i + 1}.jpg`, { type: 'image/jpeg' }));
        got++;
      }
      // The budget can stop the batch before any photo was obtained; treat that like the
      // details-budget case rather than finishing 'done' with zero photos.
      if (blocked && !got) return 'Monthly Google budget reached.';
      if (got) p = await pb.collection('places').update<Place>(p.id, form);
    }
    return p;
  });
}

/**
 * A venue's details and photos before it is added to a route (the Add Stop sheet). Goes through
 * the same per-venue queue as attach, so opening and adding a venue pays Google once.
 */
export async function venueMedia(placeRecordId: string): Promise<{ status: 'done' | 'none' | 'failed'; place: Place | null; message?: string }> {
  const pb = await adminPb();
  const place = await pb.collection('places').getOne<Place>(placeRecordId).catch(() => null);
  if (!place) return { status: 'none', place: null };
  if (place.source !== 'google' || !place.place_id || !/^[A-Za-z0-9_-]+$/.test(place.place_id)) return { status: 'none', place };
  if (place.details_at && (place.photos.length || !(place.photo_refs ?? []).length)) return { status: 'done', place };
  if (!serverEnv.googleKey) return { status: 'none', place };
  try {
    const out = await ensurePlaceMedia(pb, { key: serverEnv.googleKey }, place.place_id, {
      name: place.name, kind: place.kind, lat: place.lat, lon: place.lon, address: place.address, station_id: place.station_id
    });
    return typeof out === 'string' ? { status: 'failed', place, message: out } : { status: 'done', place: out };
  } catch (err) {
    console.error('[places] venue media', placeRecordId, err);
    return { status: 'failed', place, message: (err as Error).message };
  }
}

export function attachPlace(stopId: string, caller?: AttachCaller): Promise<AttachResult> {
  return serialize(stopQueues, stopId, () => doAttachPlace(stopId, caller));
}

async function doAttachPlace(stopId: string, caller?: AttachCaller): Promise<AttachResult> {
  const pb = await adminPb();
  // A well-formed but unknown id is an ordinary 404 from PocketBase: report it as a failed attach
  // rather than rejecting (nothing to mark 'failed' either, since there is no stop record).
  let stop: Stop;
  try {
    stop = await pb.collection('stops').getOne<Stop>(stopId);
  } catch (err) {
    console.error('[places] attach: no stop', stopId, err);
    return { status: 'failed', photos: 0, message: (err as Error).message };
  }
  // This writes as the superuser, so the stops rule (the builder's draft, or the Conductor) is
  // re-checked here instead of being bypassed — before any Google call spends the budget.
  if (caller && !caller.is_admin) {
    const it = await pb.collection('itineraries').getOne<Itinerary>(stop.itinerary).catch(() => null);
    if (!it || it.status !== 'draft') throw error(403, 'This itinerary is no longer a draft.');
    if (it.created_by !== caller.id) throw error(403, 'Only the route\'s builder or the Conductor can change it.');
  }
  const fail = async (message: string): Promise<AttachResult> => {
    await pb.collection('stops').update(stop.id, { photos_status: 'failed' });
    return { status: 'failed', photos: 0, message };
  };
  if (!serverEnv.googleKey) return fail('Google Places is not configured on the server.');
  const cfg = { key: serverEnv.googleKey };
  let place: Place | null = stop.place ? await pb.collection('places').getOne<Place>(stop.place).catch(() => null) : null;
  if (stop.photos_status === 'done' && place?.photos.length) return { status: 'done', photos: place.photos.length };
  await pb.collection('stops').update(stop.id, { photos_status: 'pending' });
  try {
    // 1. The Google place id: from the stop, from a place it already points at, or by name.
    let placeId = stop.place_id || place?.place_id || '';
    if (!placeId) {
      const s = await metra.getSchedule();
      const station = s.stations.get(stop.station_id);
      const bias = { lat: stop.lat || station?.lat || 41.88, lon: stop.lon || station?.lon || -87.64, radiusM: 1500 };
      const hit = (await searchText(cfg, `${stop.name} ${stop.station_name || station?.name || ''}`.trim(), bias))[0];
      if (!hit) return fail('Google has no match for this name near the station.');
      placeId = hit.id;
    }
    // The id becomes part of a Google URL: keep it to the characters Google uses.
    if (!/^[A-Za-z0-9_-]+$/.test(placeId)) return fail('Unexpected Google place id.');

    // 2. Details and photos, once per venue (an OpenStreetMap-sourced stop is re-pointed at the
    //    Google record for the same venue, so its photos are shared too).
    const outcome = await ensurePlaceMedia(pb, cfg, placeId, {
      name: stop.name, kind: stop.kind || 'other', lat: stop.lat, lon: stop.lon, address: stop.address, station_id: stop.station_id
    });
    if (typeof outcome === 'string') return fail(outcome);
    place = outcome;

    // 3. The stop: point at the place and fill what it does not have yet.
    await pb.collection('stops').update(stop.id, {
      place: place.id,
      place_id: placeId,
      address: place.address || stop.address,
      hours: place.hours ?? stop.hours,
      phone: stop.phone || place.phone,
      website: stop.website || place.website,
      lat: stop.lat || place.lat,
      lon: stop.lon || place.lon,
      photos_status: 'done'
    });
    return { status: 'done', photos: place.photos.length };
  } catch (err) {
    console.error('[places] attach failed for', stop.id, err);
    return fail((err as Error).message);
  }
}
