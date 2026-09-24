// The database half of the one-time canned practice route: create the itinerary and stops as an
// ordinary draft, let the planner's recompute hook answer with legs, validate every leg, and only
// then lock the route and (if nothing else is selected) make it current. No Places, no fetch: the
// caller (practice-route.mjs) supplies an `api` that talks to the real PocketBase, and the tests
// supply an in-memory fake. Nothing is visible to users before step 5 (locking).
/**
 * @typedef {{
 *   list: (collection: string, predicate: (row: Record<string, any>) => boolean) => Promise<Record<string, any>[]>,
 *   create: (collection: string, body: Record<string, any>) => Promise<Record<string, any>>,
 *   update: (collection: string, id: string, body: Record<string, any>) => Promise<unknown>,
 *   remove: (collection: string, id: string) => Promise<unknown>,
 *   getSettings: () => Promise<{ current_itinerary: string }>,
 *   setCurrent: (id: string) => Promise<unknown>
 * }} CannedRouteApi
 */
/**
 * @typedef {{ title: string, eventDate: string, startTime: string, ownerId: string, timeoutMs: number, pollMs: number }} BuildOpts
 */

export class CannedRouteError extends Error {}

/**
 * @param {CannedRouteApi} api @param {string} itineraryId @param {number} expected @param {number} timeoutMs @param {number} pollMs
 */
async function waitForLegs(api, itineraryId, expected, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const legs = await api.list('legs', (l) => l.itinerary === itineraryId);
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

  // 1. A locked route with this title refuses the run outright. Any leftover draft/archived rows
  // are this script's own failed earlier attempts and are cleared (remove cascades their stops/legs).
  const existing = await api.list('itineraries', (r) => r.title === title);
  if (existing.some((r) => r.status === 'locked')) {
    throw new CannedRouteError(`A locked canned route ("${title}") already exists.`);
  }
  for (const row of existing) await api.remove('itineraries', row.id);

  // 2. Create the itinerary (the hook forces it to draft) and the stops, in order.
  // The itineraries collection's owner field is `created_by` (see pb_migrations/1758400000_planning.js).
  const itinerary = await api.create('itineraries', { title, event_date: eventDate, start_time: startTime, created_by: ownerId });
  const itineraryId = itinerary.id;
  const createdStops = [];
  for (const [i, stop] of stops.entries()) {
    const row = await api.create('stops', { ...stop, itinerary: itineraryId, order: i + 1 });
    createdStops.push(row);
    // Places/photos attach right after each stop's own create, while the route is still a draft.
    if (stop.place_id) {
      const place = await api.create('places', {
        ref: `google:${stop.place_id}`, source: 'google', place_id: stop.place_id, name: stop.name,
        kind: stop.kind, lat: stop.lat, lon: stop.lon, address: stop.address, rating: stop.rating,
        rating_count: stop.rating_count, hours: stop.hours, phone: stop.phone, website: stop.website,
        maps_url: stop.maps_url, station_id: stop.station_id, photos: stop.photos, photo_attributions: stop.photo_attributions,
        reviews: stop.reviews, fetched_at: stop.fetched_at
      });
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
  // another recompute and the legs just checked stand.
  await api.update('itineraries', itineraryId, { status: 'locked' });

  // 6. Fall back to this route only if nothing else is already selected; never take over the
  // Conductor's own choice.
  const settings = await api.getSettings();
  if (!settings.current_itinerary) await api.setCurrent(itineraryId);

  return { id: itineraryId, legs };
}
