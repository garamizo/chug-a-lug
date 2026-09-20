import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { nearbyForStation } from '$lib/server/places/nearby';

export const GET: RequestHandler = async ({ request, url }) => {
  const user = await requireUser(request);
  const station = url.searchParams.get('station') ?? '';
  if (!/^[A-Z0-9_-]{1,32}$/i.test(station)) throw error(400, 'station is required.');
  const refresh = url.searchParams.get('refresh') === '1' && user.is_admin;
  try {
    return json(await nearbyForStation(station, refresh));
  } catch (err) {
    if ((err as { status?: number }).status) throw err;
    console.error('[places] nearby failed', station, err);
    throw error(502, 'OpenStreetMap is not answering right now. Try again in a minute or search by name.');
  }
};
