import { error } from '@sveltejs/kit';
import { serverEnv } from '$lib/server/env';
import { adminPb } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import type PocketBase from 'pocketbase';
import { haversineM } from '$lib/geo';
import { PLANNER_ROUTE } from '$lib/lineMap';
import { budgetLeft, consumeBudget } from './budget';
import { NEARBY_GROUPS, searchNearby } from './google';
import { fetchNearby } from './overpass';
import { rankNearby } from './rank';
import { placeToVenue, upsertPlace } from './store';
import type { Place, PlaceLookup, Station, Venue } from '$lib/types';

type Cached = { station: Station; venues: Venue[]; fetchedAt: string };

/** How far from the station a venue may be to make the list: half a mile. */
export const NEARBY_RADIUS_M = 805;
// Two Google calls per station (bars, restaurants), remembered until a refresh, so this guards
// against a runaway bug and keeps the month inside Google's free 1,000 Enterprise calls.
const NEARBY_LIMIT = 200;
const GROUPS = Object.values(NEARBY_GROUPS);

/**
 * Every stored venue within NEARBY_RADIUS_M of the station, measured from *this* station. Read by
 * position, not by the station a venue was first found for: neighbouring stations' circles overlap
 * (La Grange Road and Stone Ave. are 627 m apart), and a venue belongs on both lists.
 */
async function venuesAround(pb: PocketBase, station: Station): Promise<Venue[]> {
  const dLat = NEARBY_RADIUS_M / 111_320, dLon = dLat / Math.cos((station.lat * Math.PI) / 180);
  const rows = await pb.collection('places').getFullList<Place>({
    filter: pb.filter('lat >= {:s} && lat <= {:n} && lon >= {:w} && lon <= {:e}',
      { s: station.lat - dLat, n: station.lat + dLat, w: station.lon - dLon, e: station.lon + dLon })
  });
  const venues = rows.map((p) => ({ ...placeToVenue(p), distanceM: Math.round(haversineM(station.lat, station.lon, p.lat, p.lon)) }));
  return rankNearby(venues, NEARBY_RADIUS_M);
}

/**
 * The best bars and restaurants within half a mile of a station. The first lookup for a station
 * asks Google Places Nearby Search once for bars and once for restaurants (each its 20 most
 * popular, with rating and hours) or, without a key, OpenStreetMap (no ratings, so nearest first);
 * the venues land in the `places` collection and a `place_lookups` row marks the station as
 * searched. Every later call reads the database only, until a refresh.
 */
export async function nearbyForStation(stationId: string, refresh = false): Promise<Cached> {
  const s = await metra.getSchedule();
  const station = s.stations.get(stationId);
  if (!station) throw error(404, 'Unknown station.');
  const pb = await adminPb();
  const byStation = pb.filter('station_id = {:id}', { id: stationId });
  if (!refresh) {
    const lookup = await pb.collection('place_lookups').getFirstListItem<PlaceLookup>(byStation).catch(() => null);
    if (lookup) return { station, venues: await venuesAround(pb, station), fetchedAt: lookup.fetched_at };
  }
  const google = !!serverEnv.googleKey;
  const found = new Map<string, Venue>();
  if (google) {
    for (const types of GROUPS) {
      if (!(await consumeBudget(serverEnv.dataDir, 'nearby', NEARBY_LIMIT))) throw error(503, 'Monthly Google budget reached. Search by name or add the stop by name only.');
      for (const v of await searchNearby({ key: serverEnv.googleKey }, station, NEARBY_RADIUS_M, types)) found.set(v.id, v);
    }
  } else {
    for (const v of await fetchNearby({ url: serverEnv.overpassUrl }, station.lat, station.lon, NEARBY_RADIUS_M)) found.set(v.id, v);
  }
  for (const v of rankNearby([...found.values()], NEARBY_RADIUS_M)) await upsertPlace(pb, v, stationId);
  const fetchedAt = new Date().toISOString();
  const row = { station_id: stationId, source: google ? 'google' : 'osm', count: found.size, fetched_at: fetchedAt };
  const prior = await pb.collection('place_lookups').getFirstListItem<PlaceLookup>(byStation).catch(() => null);
  if (prior) await pb.collection('place_lookups').update(prior.id, row); else await pb.collection('place_lookups').create(row);
  return { station, venues: await venuesAround(pb, station), fetchedAt };
}

/**
 * Refreshes every station of the planner's line, one after another, through the same monthly
 * counter. Refuses before its first Google call when the month has too few nearby calls left.
 */
export async function warmStations(): Promise<{ stations: number; calls: number; venues: number; left: number }> {
  if (!serverEnv.googleKey) throw error(503, 'Google Places is not configured on the server.');
  const s = await metra.getSchedule();
  const line = s.lines.find((l) => l.routeId === PLANNER_ROUTE);
  if (!line) throw error(503, 'The timetable has no planner line.');
  const calls = line.stations.length * GROUPS.length;
  const left = await budgetLeft(serverEnv.dataDir, 'nearby', NEARBY_LIMIT);
  if (calls > left) throw error(409, `Warming ${line.stations.length} stations needs ${calls} nearby calls; this month has ${left} left.`);
  let venues = 0;
  for (const st of line.stations) venues += (await nearbyForStation(st.id, true)).venues.length;
  return { stations: line.stations.length, calls, venues, left: await budgetLeft(serverEnv.dataDir, 'nearby', NEARBY_LIMIT) };
}
