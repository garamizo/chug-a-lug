import { simulationClock } from '$lib/server/sim/clock';
import { ClockServiceError } from '$lib/server/sim/service';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser } from '$lib/server/pb';
import { activeAnchor, computeLegs, readStops } from '$lib/server/plan';
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

  try {
    const context = await simulationClock.readContext();
    const pb = await adminPb();
    const itinerary = await pb.collection('itineraries').getOne<Itinerary>(id);
    // The preview's anchor is "now": the save stamps its own moment, and the editor re-previews as the
    // clock moves, so a plan that has quietly become unrideable stops being savable. `activeAnchor`
    // then only lets it steer the plan on the event's own day, exactly as a save would.
    const rawAnchor = body.anchorStopId ? { stopId: body.anchorStopId, at: context.eventNow } : null;
    const anchor = activeAnchor(itinerary.event_date, rawAnchor, new Date(context.eventNow));
    const legs = await computeLegs({
      date: itinerary.event_date,
      startMin: parseHm(itinerary.start_time),
      anchor,
      stops, context
    });
    return json({ legs, anchorAt: anchor?.at ?? null, clockRevision: context.enabled ? context.revision : null });
  } catch (err) {
    if (err instanceof ClockServiceError) return json({ message: err.message, clock: err.current }, { status: err.status });
    throw err;
  }
};
