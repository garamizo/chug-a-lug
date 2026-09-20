import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra } from '$lib/server/metra';
import { stationsServedOn } from '$lib/metra/gtfs';

// With `?date=YYYY-MM-DD`, each station also says whether any train of its line stops there
// that day, so the planner can grey out the weekend-skipped ones.
export const GET: RequestHandler = async ({ request, url }) => {
  await requireUser(request);
  let s;
  try {
    s = await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  const date = url.searchParams.get('date');
  if (!date) return json({ publishedAt: s.publishedAt, lines: s.lines });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw error(400, 'date must be YYYY-MM-DD');
  const lines = s.lines.map((line) => {
    const served = stationsServedOn(s, line.routeId, date);
    return { ...line, stations: line.stations.map((st) => ({ ...st, served: served.has(st.id) })) };
  });
  return json({ publishedAt: s.publishedAt, date, lines });
};
