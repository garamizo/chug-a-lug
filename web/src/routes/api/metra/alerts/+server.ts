import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { MetraSetupError } from '$lib/server/metra/provider';
import { ClockServiceError } from '$lib/server/sim/service';
import { copy } from '$lib/labels';
import { selectAlerts } from '$lib/server/metra/decode';
import { modeFor } from '$lib/metra/live';
import { PLANNER_ROUTE, plannerStations } from '$lib/lineMap';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  let snapshot;
  try {
    snapshot = await metra.snapshot();
  } catch (e) {
    throw error(503, e instanceof MetraSetupError ? copy.simFeedUnavailable : e instanceof ClockServiceError ? copy.simUnavailable : copy.metraUnavailable);
  }
  const s = snapshot.schedule;
  const metadata = { source: snapshot.source, revision: snapshot.revision, diagnostics: snapshot.diagnostics };
  // Alerts carry their own active periods, so a stale feed is still worth showing; the mode simply
  // says how fresh it is. It is gated on the alerts feed, never on a shared timestamp.
  const mode = modeFor(snapshot.status.feeds.alerts);
  const feed = snapshot.feeds.alerts;
  const alerts = selectAlerts(feed?.message ?? null, {
    routeId: PLANNER_ROUTE,
    stationIds: new Set(plannerStations(s.lines).map((st) => st.id)),
    now: new Date(snapshot.eventNow)
  });
  return json({ ...metadata, mode, fetchedAt: feed?.fetchedAt ?? null, alerts });
};
