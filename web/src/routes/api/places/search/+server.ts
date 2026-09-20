import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { serverEnv } from '$lib/server/env';
import { metra } from '$lib/server/metra';
import { searchText } from '$lib/server/places/google';

export const GET: RequestHandler = async ({ request, url }) => {
  await requireUser(request);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const stationId = url.searchParams.get('station') ?? '';
  if (q.length < 2) throw error(400, 'Type at least two characters.');
  if (!serverEnv.googleKey) throw error(503, 'Search by name is not configured on the server.');
  const s = await metra.getSchedule();
  const station = s.stations.get(stationId);
  if (!station) throw error(404, 'Unknown station.');
  try {
    return json({ venues: await searchText({ key: serverEnv.googleKey }, `${q} near ${station.name}`, { lat: station.lat, lon: station.lon, radiusM: 1500 }) });
  } catch (err) {
    console.error('[places] search failed', err);
    throw error(502, 'Google search failed. Try again or add the stop by name only.');
  }
};
