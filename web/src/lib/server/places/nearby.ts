import { error } from '@sveltejs/kit';
import { serverEnv } from '$lib/server/env';
import { adminPb } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { consumeBudget } from './budget';
import { searchNearby } from './google';
import { fetchNearby } from './overpass';
import { rankNearby } from './rank';
import { placeToVenue, upsertPlace } from './store';
import type { Place, PlaceLookup, Station, Venue } from '$lib/types';

type Cached = { station: Station; venues: Venue[]; fetchedAt: string };

/** How far from the station a venue may be to make the list. */
export const NEARBY_RADIUS_M = 250;
// One Google call per station, remembered forever, so this only guards against a runaway bug.
const NEARBY_LIMIT = 200;

/**
 * Bars and restaurants within NEARBY_RADIUS_M of a station, best rated first. The first lookup
 * for a station asks Google Places Nearby Search (ratings included) or, without a key,
 * OpenStreetMap (no ratings, so nearest first); the venues land in the `places` collection and
 * a `place_lookups` row marks the station as searched. Every later call reads the database only,
 * until the Conductor asks for refresh=true.
 */
export async function nearbyForStation(stationId: string, refresh = false): Promise<Cached> {
  const s = await metra.getSchedule();
  const station = s.stations.get(stationId);
  if (!station) throw error(404, 'Unknown station.');
  const pb = await adminPb();
  const byStation = pb.filter('station_id = {:id}', { id: stationId });
  if (!refresh) {
    const lookup = await pb.collection('place_lookups').getFirstListItem<PlaceLookup>(byStation).catch(() => null);
    if (lookup) {
      const rows = await pb.collection('places').getFullList<Place>({ filter: byStation });
      return { station, venues: rankNearby(rows.map(placeToVenue), NEARBY_RADIUS_M), fetchedAt: lookup.fetched_at };
    }
  }
  const google = !!serverEnv.googleKey;
  let found: Venue[];
  if (google) {
    if (!(await consumeBudget(serverEnv.dataDir, 'nearby', NEARBY_LIMIT))) throw error(503, 'Monthly Google budget reached. Search by name or add the stop by name only.');
    found = await searchNearby({ key: serverEnv.googleKey }, station, NEARBY_RADIUS_M);
  } else {
    found = await fetchNearby({ url: serverEnv.overpassUrl }, station.lat, station.lon, NEARBY_RADIUS_M);
  }
  const venues = rankNearby(found, NEARBY_RADIUS_M);
  for (const v of venues) v.placeRef = (await upsertPlace(pb, v, stationId)).id;
  const fetchedAt = new Date().toISOString();
  const row = { station_id: stationId, source: google ? 'google' : 'osm', count: venues.length, fetched_at: fetchedAt };
  const prior = await pb.collection('place_lookups').getFirstListItem<PlaceLookup>(byStation).catch(() => null);
  if (prior) await pb.collection('place_lookups').update(prior.id, row); else await pb.collection('place_lookups').create(row);
  return { station, venues, fetchedAt };
}
