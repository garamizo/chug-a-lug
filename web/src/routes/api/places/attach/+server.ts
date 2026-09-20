import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { attachPlace } from '$lib/server/places/attach';

export const POST: RequestHandler = async ({ request }) => {
  const user = await requireUser(request);
  const body = await request.json().catch(() => ({}));
  const stopId = typeof body.stopId === 'string' ? body.stopId : '';
  if (!/^[a-z0-9]{15}$/.test(stopId)) throw error(400, 'stopId is required.');
  return json(await attachPlace(stopId, user));
};
