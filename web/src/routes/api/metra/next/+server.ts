import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { MetraSetupError } from '$lib/server/metra/provider';
import { ClockServiceError } from '$lib/server/sim/service';
import { copy } from '$lib/labels';
import { readPredictions } from '$lib/server/metra/decode';
import { DELAY_LOOKBACK_MIN, modeFor, selectDepartures } from '$lib/metra/live';
import { PLANNER_ROUTE } from '$lib/lineMap';
import { nextTrips } from '$lib/metra/plan';
import { localToUtc, minutesOfDay } from '$lib/time';
import type { NextTrip } from '$lib/types';

export const GET: RequestHandler = async ({ request, url }) => {
  await requireUser(request);
  let snapshot;
  try {
    snapshot = await metra.snapshot();
  } catch (e) {
    throw error(503, e instanceof MetraSetupError ? copy.simFeedUnavailable : e instanceof ClockServiceError ? copy.simUnavailable : copy.metraUnavailable);
  }
  const s = snapshot.schedule;
  const metadata = { source: snapshot.source, revision: snapshot.revision, diagnostics: snapshot.diagnostics };
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const date = url.searchParams.get('date') ?? snapshot.serviceDate ?? '';
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw error(400, 'from, to and date=YYYY-MM-DD are required.');
  const after = url.searchParams.get('after');
  let afterDate = new Date(snapshot.eventNow);
  if (after) {
    afterDate = new Date(after);
    if (Number.isNaN(afterDate.getTime())) throw error(400, 'after must be a valid ISO date-time.');
  }
  const limitParam = url.searchParams.get('limit');
  const limitNum = limitParam === null ? 3 : Number(limitParam);
  if (Number.isNaN(limitNum)) throw error(400, 'limit must be a number.');
  const limit = Math.min(10, Math.max(1, limitNum));
  const afterMin = minutesOfDay(date, afterDate);
  // Trip predictions are only as trustworthy as the tripupdates feed itself. A healthy positions or
  // alerts feed says nothing about whether departures are still being published.
  const mode = modeFor(snapshot.status.feeds.tripupdates);

  // Practice days run the plan date's published timetable; today's realtime belongs to another day.
  const practice = url.searchParams.get('practice') === '1';
  const effectiveMode = practice ? 'schedule_only' : mode;

  // Look back before `after` so a delayed train is still a candidate, and take more than the caller
  // asked for so cancellations cannot empty the result. Both are trimmed by selectDepartures.
  const fromMin = Math.max(0, afterMin - DELAY_LOOKBACK_MIN);
  const candidates: NextTrip[] = nextTrips(s, from, to, fromMin, date, limit + 8).map((c) => ({
    tripId: c.tripId, routeId: c.routeId, headsign: c.headsign,
    schedDepart: localToUtc(date, c.dep).toISOString(), schedArrive: localToUtc(date, c.arr).toISOString(),
    liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled'
  }));
  // Stale times are worse than none: fall back to the timetable rather than show old predictions.
  const preds = effectiveMode === 'live' ? readPredictions(snapshot.feeds.tripupdates?.message ?? null, PLANNER_ROUTE, date) : {};
  // The board shows this as "no live times since", so it must be the trip-update feed's own
  // timestamp — not the newest fetch across feeds, which a healthy alerts poll keeps refreshing.
  const fetchedAt = snapshot.status.feeds.tripupdates.fetchedAt;
  return json({ ...metadata, mode: effectiveMode, fetchedAt: practice ? null : fetchedAt, trips: selectDepartures(candidates, preds, from, to, afterDate, limit) });
};
