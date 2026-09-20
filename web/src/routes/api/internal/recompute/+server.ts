import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireInternal } from '$lib/server/pb';
import { recomputeItinerary } from '$lib/server/recompute';

// Called by the PocketBase stops/itineraries hooks, which block on the response: queue the work and
// answer straight away (202). The browser learns about the new legs from PocketBase realtime, and
// recomputeItinerary logs its own failures, so nothing is lost by not awaiting.
export const POST: RequestHandler = async ({ request, url }) => {
  requireInternal(request);
  const id = url.searchParams.get('itinerary');
  if (!id || !/^[a-z0-9]{15}$/.test(id)) throw error(400, 'itinerary id required');
  void recomputeItinerary(id);
  return json({ queued: true }, { status: 202 });
};
