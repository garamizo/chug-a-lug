import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { nearbyForStation } from '$lib/server/places/nearby';
import { describePbError } from '$lib/server/places/store';

export const GET: RequestHandler = async ({ request, url }) => {
  const user = await requireUser(request);
  const station = url.searchParams.get('station') ?? '';
  if (!/^[A-Z0-9_-]{1,32}$/i.test(station)) throw error(400, 'station is required.');
  const refresh = url.searchParams.get('refresh') === '1' && user.is_admin;
  try {
    return json(await nearbyForStation(station, refresh));
  } catch (err) {
    // Only our own error(...) calls pass through; a PocketBase or Google failure gets a message the
    // picker can show instead of SvelteKit's bare "Internal Error".
    if (isHttpError(err)) throw err;
    console.error('[places] nearby failed', station, err);
    const pbMessage = describePbError(err);
    if (pbMessage) throw error(502, pbMessage);
    throw error(502, 'The venue lookup is not answering right now. Try again in a minute or search by name.');
  }
};
