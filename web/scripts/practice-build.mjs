// The database half of the one-time canned practice route: create the itinerary and stops as an
// ordinary draft, let the planner's recompute hook answer with legs, validate every leg, and only
// then lock the route. It does not touch `crawl_settings.current_itinerary`; the newest-locked
// fallback in resolveCurrentRoute makes this route current on its own. No Places, no fetch: the
// caller (practice-route.mjs) supplies an `api` that talks to the real PocketBase, and the tests
// supply an in-memory fake. Nothing is visible to users before step 5 (locking).
/**
 * @typedef {{
 *   list: (collection: string, predicate: (row: Record<string, any>) => boolean, filter?: string) => Promise<Record<string, any>[]>,
 *   create: (collection: string, body: Record<string, any>) => Promise<Record<string, any>>,
 *   update: (collection: string, id: string, body: Record<string, any>) => Promise<unknown>,
 *   remove: (collection: string, id: string) => Promise<unknown>
 * }} CannedRouteApi
 */
/**
 * @typedef {{ title: string, eventDate: string, startTime: string, ownerId: string, timeoutMs: number, pollMs: number }} BuildOpts
 */

export class CannedRouteError extends Error {}

// Only these land on the `stops` collection; everything else on a stop object (rating, reviews,
// photos, maps_url, ...) is place data and goes to `places` instead, below.
const STOP_FIELDS = ['name', 'kind', 'station_id', 'station_name', 'place_id', 'osm_id', 'address',
  'lat', 'lon', 'hours', 'phone', 'website', 'confirmed_open', 'dwell_min', 'walk_min', 'notes',
  'meet_point', 'direction'];

/** @param {Record<string, any>} obj @param {string[]} keys */
function pick(obj, keys) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** A PocketBase filter clause for an exact string match, quotes escaped. @param {string} field @param {string} value */
function eq(field, value) { return `${field} = "${String(value).replace(/"/g, '\\"')}"`; }

/**
 * @param {CannedRouteApi} api @param {string} itineraryId @param {number} expected @param {number} timeoutMs @param {number} pollMs
 */
async function waitForLegs(api, itineraryId, expected, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const legs = await api.list('legs', (l) => l.itinerary === itineraryId, eq('itinerary', itineraryId));
    if (legs.length >= expected) return legs;
    if (Date.now() >= deadline) {
      throw new CannedRouteError(`The planner timed out waiting for the recompute; the draft ${itineraryId} is left for inspection.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * @param {CannedRouteApi} api @param {Record<string, any>[]} stops @param {BuildOpts} opts
 * @returns {Promise<{ id: string, legs: Record<string, any>[] }>}
 */
export async function buildCannedRoute(api, stops, opts) {
  const { title, eventDate, startTime, ownerId, timeoutMs, pollMs } = opts;

  // 1. A locked route with this title refuses the run outright. A leftover draft row with this
  // title is this script's own failed earlier attempt and is cleared (remove cascades its stops
  // and legs, but not places — see step 2). An archived route with this title is a real, once-live
  // route the Conductor archived; it is neither a blocker nor this script's to delete.
  const existing = await api.list('itineraries', (r) => r.title === title, eq('title', title));
  if (existing.some((r) => r.status === 'locked')) {
    throw new CannedRouteError(`A locked canned route ("${title}") already exists.`);
  }
  for (const row of existing) if (row.status === 'draft') await api.remove('itineraries', row.id);

  // 2. Create the itinerary (the hook forces it to draft) and the stops, in order.
  // The itineraries collection's owner field is `created_by` (see pb_migrations/1758400000_planning.js).
  const itinerary = await api.create('itineraries', { title, event_date: eventDate, start_time: startTime, created_by: ownerId });
  const itineraryId = itinerary.id;
  const createdStops = [];
  for (const [i, stop] of stops.entries()) {
    const row = await api.create('stops', { ...pick(stop, STOP_FIELDS), itinerary: itineraryId, order: i + 1 });
    createdStops.push(row);
    // Places/photos attach right after each stop's own create, while the route is still a draft.
    // `places.ref` is unique (idx_places_ref): production already has place rows from the
    // planner's own nearby lookup (see `store.ts`'s upsertPlace/findPlace, which this mirrors), and
    // a retry after a partial failure collides with places this same script created earlier. Look
    // the place up by ref first and reuse it as-is; only create when it is genuinely missing. A
    // real-route stop may already share this place, so an existing row's fields/photos are never
    // touched here.
    if (stop.place_id) {
      const ref = `google:${stop.place_id}`;
      let place = (await api.list('places', (r) => r.ref === ref, eq('ref', ref)))[0];
      if (!place) {
        place = await api.create('places', {
          ref, source: 'google', place_id: stop.place_id, name: stop.name,
          kind: stop.kind, lat: stop.lat, lon: stop.lon, address: stop.address, rating: stop.rating,
          rating_count: stop.rating_count, hours: stop.hours, phone: stop.phone, website: stop.website,
          maps_url: stop.maps_url, station_id: stop.station_id, photos: stop.photos, photo_attributions: stop.photo_attributions,
          reviews: stop.reviews, fetched_at: stop.fetched_at,
          // Without this, attach.ts:92 reads the place as "no details yet" even though it has them.
          details_at: stop.fetched_at
        });
      }
      await api.update('stops', row.id, { place: place.id, photos_status: 'done' });
    }
  }

  // 3. Poll until the recompute hook has answered every leg, or give up and leave the draft.
  const legs = await waitForLegs(api, itineraryId, createdStops.length - 1, timeoutMs, pollMs);

  // 4. Every leg must be a train ride or a walk; an impossible leg leaves the route a draft.
  const impossible = legs.filter((l) => l.kind !== 'train' && l.kind !== 'walk');
  if (impossible.length) {
    const named = impossible.map((l) => `${l.from_stop ?? '?'} -> ${l.to_stop ?? '?'}`).join(', ');
    throw new CannedRouteError(`Cannot build the canned route: impossible legs: ${named}. The draft ${itineraryId} is left for inspection.`);
  }

  // 5. Only now lock it. Locking does not touch start_time/event_date, so it does not trigger
  // another recompute and the legs just checked stand. Nothing sets `current_itinerary` here: the
  // newest-locked fallback in resolveCurrentRoute already makes this route current until a real
  // route is locked, and from then on the real route takes over with nobody pressing anything.
  await api.update('itineraries', itineraryId, { status: 'locked' });

  return { id: itineraryId, legs };
}
