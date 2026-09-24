// Bounded, cached Google Places download. Keys stay in request headers and never enter artifacts.
// Pure selectors and the canned-route plan live above the HTTP/cache code below, which
// practice-route.mjs's Places client and rehearsalVenues (kept for its field masks and
// photo-download shape) both build on.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {{ id: string, lat: number, lon: number, name?: string }} Station */
/**
 * @typedef {{
 *   id: string, displayName?: { text?: string }, location: { latitude: number, longitude: number },
 *   primaryType?: string, types?: string[], businessStatus?: string, rating?: number, userRatingCount?: number,
 *   regularOpeningHours?: { periods?: Array<{ open?: { day: number, hour: number, minute?: number }, close?: { day: number, hour: number, minute?: number } }> }
 * }} Place
 */

export const CANNED_TITLE = 'Out and back on the BNSF — practice crawl';
export const PLAN = [
  { station: 'AURORA', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'NAPERVILLE', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'LISLE', role: 'lunch', direction: 'out', dwell: 60 },
  { station: 'MAINST-DG', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'LAGRANGE', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'HINSDALE', role: 'bar', direction: 'in', dwell: 30 },
  { station: 'WESTMONT', role: 'bar', direction: 'in', dwell: 30 },
  { station: 'NAPERVILLE', role: 'dinner', direction: 'in', dwell: 75 },
  { station: 'ROUTE59', role: 'bar', direction: 'in', dwell: 30 }
];

/** @type {(p: Place, s: Station) => number} */
const metres = (p, s) => Math.hypot((p.location.latitude - s.lat) * 111000, (p.location.longitude - s.lon) * 83000);
/** @type {(p: Place, used: Set<string>, minRatings: number) => boolean} */
const usable = (p, used, minRatings) => !!p.location && p.businessStatus === 'OPERATIONAL' && (p.userRatingCount ?? 0) >= minRatings && !used.has(p.id);
/** @type {(p: Place) => boolean} */
const isBar = (p) => ['bar', 'pub', 'brewery'].includes(p.primaryType ?? '') || (p.types ?? []).some((t) => ['bar', 'pub', 'brewery'].includes(t));
/** @type {(p: Place) => boolean} */
const isRestaurant = (p) => (p.primaryType ?? '').endsWith('restaurant');
/** @type {(p: Place) => boolean} */
const openAtNoonSaturday = (p) => (p.regularOpeningHours?.periods ?? []).some((x) => x.open?.day === 6 &&
  x.open.hour * 60 + (x.open.minute ?? 0) <= 12 * 60 && (!x.close || x.close.hour * 60 + (x.close.minute ?? 0) >= 13 * 60 || x.close.day !== 6));

/**
 * Nearest operational bar/pub/brewery with at least 20 ratings, never reused.
 * @param {Place[]} places @param {Station} station @param {Set<string>} used @returns {Place | null}
 */
export function pickBar(places, station, used) {
  return places.filter((p) => usable(p, used, 20) && isBar(p)).sort((a, b) => metres(a, station) - metres(b, station))[0] ?? null;
}
/**
 * Highest-rated restaurant within walking distance, open at noon Saturday, with at least 200 ratings.
 * @param {Place[]} places @param {Station} station @param {Set<string>} used @returns {Place | null}
 */
export function pickLunch(places, station, used) {
  return places.filter((p) => usable(p, used, 200) && isRestaurant(p) && openAtNoonSaturday(p) && metres(p, station) <= 1000)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null;
}
/**
 * Best-rated "deep dish pizza" text-search result across every outbound station's candidates.
 * Candidates must already be walking-distance-filtered (see `deepDishCandidates`): `locationBias`
 * on a Places text search does not restrict results, so an unfiltered far venue can win here and
 * later blow the stops schema's `walk_min` cap.
 * @param {Record<string, Place[]>} candidatesByStation @param {Set<string>} used
 * @returns {{ station: string, place: Place } | null}
 */
export function pickDeepDish(candidatesByStation, used) {
  const all = Object.entries(candidatesByStation).flatMap(([station, places]) => places.filter((p) => usable(p, used, 100)).map((place) => ({ station, place })));
  return all.sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0))[0] ?? null;
}
/**
 * Keeps only deep-dish candidates within walking distance (1000m) of the station whose search
 * turned them up, and — when the same place turns up near more than one outbound station — keeps
 * it only under the nearest one, so `pickDeepDish` never has to choose between two entries for the
 * same place.
 * @param {Record<string, Place[]>} candidatesByStation @param {Record<string, Station>} stations
 * @returns {Record<string, Place[]>}
 */
export function deepDishCandidates(candidatesByStation, stations) {
  /** @type {Map<string, { station: string, place: Place, distance: number }>} */
  const nearest = new Map();
  for (const [stationId, places] of Object.entries(candidatesByStation)) {
    const station = stations[stationId];
    if (!station) continue;
    for (const place of places) {
      if (!place.location) continue;
      const distance = metres(place, station);
      if (distance > 1000) continue;
      const current = nearest.get(place.id);
      if (!current || distance < current.distance) nearest.set(place.id, { station: stationId, place, distance });
    }
  }
  /** @type {Record<string, Place[]>} */
  const result = {};
  for (const { station, place } of nearest.values()) (result[station] ??= []).push(place);
  return result;
}
/**
 * The next Saturday after `today` whose date is not already taken by a locked route.
 * @param {string} today @param {string[]} taken @returns {string}
 */
export function nextFreeSaturday(today, taken) {
  const d = new Date(`${today}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7)); } while (taken.includes(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}

// A thin, reusable Google Places client: practice-route.mjs uses it for searchNearby (bars, lunch)
// and searchText (deep-dish), while rehearsalVenues below keeps its own inline copy of the same
// low-level call shape (field masks, timeouts) since it is retained verbatim from the old script.
/**
 * @param {string | undefined} key
 */
export function placesClient(key) {
  if (!key) throw new Error('Google Places must be configured (GOOGLE_PLACES_KEY).');
  const apiKey = key; // Narrowed to `string` above; the check does not persist into the nested closure's own type view.
  /** @param {string} path @param {string} [mask] @param {Record<string, unknown>} [body] */
  async function call(path, mask, body) {
    const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-Goog-Api-Key': apiKey, ...(mask ? { 'X-Goog-FieldMask': mask } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
    return response;
  }
  const searchMask = 'places.id,places.displayName,places.location,places.primaryType,places.types,places.businessStatus,places.rating,places.userRatingCount,places.regularOpeningHours';
  const detailMask = 'id,displayName,formattedAddress,location,regularOpeningHours,rating,userRatingCount,reviews,nationalPhoneNumber,websiteUri,googleMapsUri,photos';
  return {
    /** @param {Station} center @param {number} radius @param {string[]} includedTypes @returns {Promise<Place[]>} */
    async searchNearby(center, radius, includedTypes) {
      const result = await call('places:searchNearby', searchMask, {
        includedTypes, maxResultCount: 20, locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lon }, radius } }
      }).then((r) => r.json());
      return result.places ?? [];
    },
    /** @param {string} textQuery @param {Station} center @param {number} radius @returns {Promise<Place[]>} */
    async searchText(textQuery, center, radius) {
      const result = await call('places:searchText', searchMask, {
        textQuery, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lon }, radius } }
      }).then((r) => r.json());
      return result.places ?? [];
    },
    /** @param {string} id @returns {Promise<any>} */
    async details(id) { return call(`places/${id}`, detailMask).then((r) => r.json()); },
    /** @param {string} name @param {string} directory @param {string} filename @param {number} [maxWidthPx] */
    async photo(name, directory, filename, maxWidthPx = 800) {
      const response = await call(`${name}/media?maxWidthPx=${maxWidthPx}`);
      await writeFile(join(directory, filename), new Uint8Array(await response.arrayBuffer()));
    }
  };
}

/**
 * @param {Station[]} stations @param {string} directory
 */
export async function rehearsalVenues(stations, directory) {
  const rawKey = process.env.GOOGLE_PLACES_KEY;
  if (!rawKey) throw new Error('Google Places must be configured to prepare rehearsal venue photos and details.');
  const key = rawKey;
  await mkdir(directory, { recursive: true });
  /** @param {string} path @param {string} [mask] @param {Record<string, unknown>} [body] */
  async function google(path, mask, body) {
    const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-Goog-Api-Key': key, ...(mask ? { 'X-Goog-FieldMask': mask } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
    return response;
  }
  const stops = [];
  for (const station of stations) {
    const cache = join(directory, `${station.id}.json`);
    let venues = await readFile(cache, 'utf8').then(JSON.parse).catch(() => null);
    if (!venues) {
      const result = await google('places:searchNearby', 'places.id,places.displayName,places.location,places.primaryType,places.businessStatus,places.userRatingCount', {
        includedTypes: ['bar', 'pub', 'brewery', 'restaurant'], maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: station.lat, longitude: station.lon }, radius: 1000 } }
      }).then(r => r.json());
      /** @type {(p: Place) => number} */
      const distance = p => Math.hypot((p.location.latitude - station.lat) * 111000, (p.location.longitude - station.lon) * 83000);
      /** @type {Place[]} */
      const candidates = (result.places ?? []).filter((/** @type {Place} */ p) => p.location && p.businessStatus === 'OPERATIONAL' && (p.userRatingCount ?? 0) >= 20 && !/^(bar|pub|restaurant)$/i.test(p.displayName?.text?.trim() ?? '')).sort((/** @type {Place} */ a, /** @type {Place} */ b) => distance(a) - distance(b));
      const bar = candidates.find((p) => ['bar', 'pub', 'brewery'].includes(p.primaryType ?? '')) ?? candidates[0];
      const food = candidates.find((p) => p.id !== bar?.id && (p.primaryType ?? '').endsWith('restaurant')) ?? candidates.find((p) => p.id !== bar?.id);
      if (!bar || !food) throw new Error(`Need two walkable venues at ${station.name}.`);
      venues = [];
      for (const [i, p] of [bar, food].entries()) {
        const detail = await google(`places/${p.id}`, 'id,displayName,formattedAddress,location,regularOpeningHours,rating,userRatingCount,reviews,nationalPhoneNumber,websiteUri,googleMapsUri,photos').then(r => r.json());
        const photos = [];
        for (const [j, photo] of (detail.photos ?? []).slice(0, 2).entries()) {
          const filename = `${station.id}-${i}-${j}.jpg`;
          const response = await google(`${photo.name}/media?maxWidthPx=800`);
          await writeFile(join(directory, filename), new Uint8Array(await response.arrayBuffer()));
          photos.push({ file: filename, attribution: (photo.authorAttributions ?? []).map((/** @type {any} */ a) => a.displayName).join(', ') });
        }
        venues.push({ place_id: p.id, name: detail.displayName?.text, address: detail.formattedAddress,
          lat: detail.location.latitude, lon: detail.location.longitude, kind: i === 0 ? 'bar' : 'restaurant',
          hours: { source: 'google', weekday: detail.regularOpeningHours?.weekdayDescriptions ?? [] },
          rating: detail.rating, rating_count: detail.userRatingCount, phone: detail.nationalPhoneNumber,
          website: detail.websiteUri, maps_url: detail.googleMapsUri, photos,
          reviews: (detail.reviews ?? []).slice(0, 3).map((/** @type {any} */ r) => ({ text: r.text?.text ?? '', author: r.authorAttribution?.displayName ?? '', url: r.googleMapsUri ?? '', rating: r.rating })),
          fetched_at: new Date().toISOString(), walk_min: Math.max(2, Math.ceil(distance(p) * 1.4 / 75)) });
      }
      await writeFile(cache, JSON.stringify(venues, null, 2));
    }
    for (const [i, venue] of venues.entries()) stops.push({ ...venue, station_id: station.id, station_name: station.name,
      dwell_min: i === 0 ? 25 : 40, direction: 'out' });
  }
  return stops;
}
