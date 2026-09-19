import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireInternal } from '$lib/server/pb';
import { recomputeItinerary } from '$lib/server/recompute';

export const POST: RequestHandler = async ({ request, url }) => {
  requireInternal(request);
  const id = url.searchParams.get('itinerary');
  if (!id || !/^[a-z0-9]{15}$/.test(id)) throw error(400, 'itinerary id required');
  try {
    return json(await recomputeItinerary(id));
  } catch (err) {
    console.error('[recompute]', id, err);
    throw error(500, (err as Error).message);
  }
};
