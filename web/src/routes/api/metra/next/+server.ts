import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { nextTrips } from '$lib/metra/plan';
import { localToUtc, minutesOfDay } from '$lib/time';
import type { NextTrip } from '$lib/types';

export const GET: RequestHandler = async ({ request, url }) => {
  await requireUser(request);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const date = url.searchParams.get('date') ?? '2026-12-26';
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw error(400, 'from, to and date=YYYY-MM-DD are required.');
  const after = url.searchParams.get('after');
  let afterDate = new Date();
  if (after) {
    afterDate = new Date(after);
    if (Number.isNaN(afterDate.getTime())) throw error(400, 'after must be a valid ISO date-time.');
  }
  const limitParam = url.searchParams.get('limit');
  const limitNum = limitParam === null ? 3 : Number(limitParam);
  if (Number.isNaN(limitNum)) throw error(400, 'limit must be a number.');
  const limit = Math.min(10, Math.max(1, limitNum));
  const afterMin = minutesOfDay(date, afterDate);
  let s;
  try {
    s = await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  const trips: NextTrip[] = nextTrips(s, from, to, afterMin, date, limit).map((c) => ({
    tripId: c.tripId, routeId: c.routeId, headsign: c.headsign,
    schedDepart: localToUtc(date, c.dep).toISOString(), schedArrive: localToUtc(date, c.arr).toISOString(),
    liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled'
  }));
  return json({ mode: 'schedule_only', trips });
};
