import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser } from '$lib/server/pb';
import { computeLegs, readStops } from '$lib/server/plan';
import { parseHm } from '$lib/time';
import type { Itinerary } from '$lib/types';

// A dry run of the same planner the commit endpoint writes with: what the Conductor previews is what
// a save produces. Writes nothing, so any signed-in user may call it.
export const POST: RequestHandler = async ({ request }) => {
  await requireUser(request);
  const body = (await request.json()) as { itinerary?: string; anchorStopId?: string | null; stops?: unknown };
  const id = String(body.itinerary ?? '');
  if (!/^[a-z0-9]{15}$/.test(id)) throw error(400, 'itinerary id required');
  const stops = readStops(body.stops);

  const pb = await adminPb();
  const itinerary = await pb.collection('itineraries').getOne<Itinerary>(id);
  // The preview's anchor is "now": the save stamps its own moment, and the editor re-previews as the
  // clock moves, so a plan that has quietly become unrideable stops being savable.
  const anchorAt = body.anchorStopId ? new Date().toISOString() : null;
  const legs = await computeLegs({
    date: itinerary.event_date,
    startMin: parseHm(itinerary.start_time),
    anchor: body.anchorStopId && anchorAt ? { stopId: body.anchorStopId, at: anchorAt } : null,
    stops
  });
  return json({ legs, anchorAt });
};
