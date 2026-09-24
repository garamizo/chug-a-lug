// The server's calendar day. Every activity row is stamped by the server, so "today" on Live has to
// be the server's today too, not whatever the phone's clock claims.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { simulationClock } from '$lib/server/sim/clock';
import { todayInTz } from '$lib/time';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  const context = await simulationClock.readContext();
  // `now` lets the client keep counting the server's day between polls and while offline.
  // `revision` as the Metra endpoints send it: in the harness the client drops an answer without it.
  return json({ today: todayInTz(new Date(context.eventNow)), now: context.eventNow, revision: context.enabled ? context.revision : null }, { headers: { 'cache-control': 'no-store' } });
};
