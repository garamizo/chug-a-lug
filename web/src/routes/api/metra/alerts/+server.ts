import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra, metraRt } from '$lib/server/metra';
import { selectAlerts } from '$lib/server/metra/decode';
import { modeFor } from '$lib/metra/live';
import { PLANNER_ROUTE, plannerStations } from '$lib/lineMap';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  let s;
  try {
    s = await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  metraRt.start();
  // Alerts carry their own active periods, so a stale feed is still worth showing; the mode simply
  // says how fresh it is. It is gated on the alerts feed, never on a shared timestamp.
  const mode = modeFor(metraRt.statusOf('alerts'));
  const feed = metraRt.feeds().alerts;
  const alerts = selectAlerts(feed?.message ?? null, {
    routeId: PLANNER_ROUTE,
    stationIds: new Set(plannerStations(s.lines).map((st) => st.id)),
    now: new Date()
  });
  return json({ mode, fetchedAt: feed?.fetchedAt ?? null, alerts });
};
