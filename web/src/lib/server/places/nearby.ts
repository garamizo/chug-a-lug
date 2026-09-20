import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { serverEnv } from '$lib/server/env';
import { metra } from '$lib/server/metra';
import { readJson, writeJson } from './cache';
import { fetchNearby } from './overpass';
import type { Station, Venue } from '$lib/types';

type Cached = { station: Station; venues: Venue[]; fetchedAt: string };

/** Venues within 800 m of a station, cached forever on disk (refresh=true re-queries Overpass). */
export async function nearbyForStation(stationId: string, refresh = false): Promise<Cached> {
  const s = await metra.getSchedule();
  const station = s.stations.get(stationId);
  if (!station) throw error(404, 'Unknown station.');
  const path = join(serverEnv.dataDir, 'places', 'nearby', `${stationId}.json`);
  if (!refresh) {
    const hit = await readJson<Cached>(path);
    if (hit) return hit;
  }
  const venues = await fetchNearby({ url: serverEnv.overpassUrl }, station.lat, station.lon, 800);
  const out: Cached = { station, venues, fetchedAt: new Date().toISOString() };
  await writeJson(path, out);
  return out;
}
