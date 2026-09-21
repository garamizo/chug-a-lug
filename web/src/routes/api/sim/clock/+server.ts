import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { copy } from '$lib/labels';
import { requireUser } from '$lib/server/pb';
import { simulationClock } from '$lib/server/sim/clock';
import { ClockServiceError } from '$lib/server/sim/service';

const headers = { 'Cache-Control': 'no-store', Vary: 'Authorization' };
const failure = (err: unknown) => {
  if (isHttpError(err)) return json(err.body, { status: err.status, headers });
  if (!(err instanceof ClockServiceError)) throw err;
  return json({ message: err.message, ...(err.current ? { clock: err.current } : {}) }, { status: err.status, headers });
};
export const GET: RequestHandler = async ({ request }) => {
  try {
    await requireUser(request);
    return json(await simulationClock.readContext(), { headers });
  }
  catch (err) { return failure(err); }
};
export const POST: RequestHandler = async ({ request }) => {
  try {
    const user = await requireUser(request);
    if (!user.is_admin) throw error(403, copy.simAdminOnly);
  } catch (err) { return failure(err); }
  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    body = value;
  } catch { return json({ message: copy.simInvalidControl }, { status: 400, headers }); }
  try { return json(await simulationClock.change(body.expectedRevision, body), { headers }); }
  catch (err) { return failure(err); }
};
