import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { venueMedia } from '$lib/server/places/attach';

// A venue's photos before it is added: fetched from Google once, then shared by every later stop.
export const POST: RequestHandler = async ({ request }) => {
  await requireUser(request);
  const body = await request.json().catch(() => ({}));
  const placeRef = typeof body.placeRef === 'string' ? body.placeRef : '';
  if (!/^[a-z0-9]{15}$/.test(placeRef)) throw error(400, 'placeRef is required.');
  return json(await venueMedia(placeRef));
};
