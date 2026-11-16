import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireInternal } from '$lib/server/pb';
import { recomputeItinerary } from '$lib/server/recompute';
import { todayInTz } from '$lib/time';

// Called by the PocketBase stops/itineraries hooks, which block on the response: queue the work and
// answer straight away (202). The browser learns about the new legs from PocketBase realtime, and
// recomputeItinerary logs its own failures, so nothing is lost by not awaiting.
//
// `?all=1` is the operator's replan-everything (`just recompute-all`): it awaits each route in turn
// and reports which ones failed, so a re-run is the retry. Only routes whose crawl day is today or
// later in Chicago are replanned; a past route's legs are the day as it was, and stay that way.
export const POST: RequestHandler = async ({ request, url }) => {
  requireInternal(request);
  if (url.searchParams.get('all') === '1') {
    const pb = await adminPb();
    const today = todayInTz();
    const ids = (await pb.collection('itineraries').getFullList<{ id: string; event_date: string }>({ fields: 'id,event_date' }))
      .filter((r) => r.event_date >= today).map((r) => r.id);
    const ok: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try { await recomputeItinerary(id); ok.push(id); }
      catch (e) { failed.push({ id, error: e instanceof Error ? e.message : String(e) }); }
    }
    return json({ ok, failed }, { status: failed.length ? 500 : 200 });
  }
  const id = url.searchParams.get('itinerary');
  if (!id || !/^[a-z0-9]{15}$/.test(id)) throw error(400, 'itinerary id required');
  void recomputeItinerary(id);
  return json({ queued: true }, { status: 202 });
};
