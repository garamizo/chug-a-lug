import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireInternal } from '$lib/server/pb';
import { warmStations } from '$lib/server/places/nearby';

// `just places-warm`: refreshes every station's bar and restaurant list through the monthly Google
// counter. Internal-secret only, so it needs no crew login; it refuses when the month is short.
export const POST: RequestHandler = async ({ request }) => {
  requireInternal(request);
  return json(await warmStations());
};
