import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser } from '$lib/server/pb';
import { computeLegs } from '$lib/server/plan';
import { recomputeItinerary } from '$lib/server/recompute';
import { cohesionBlockers } from '$lib/live/cohesion';
import { copy } from '$lib/labels';
import { parseHm } from '$lib/time';
import type { BulletinKind } from '$lib/live/diff';
import type { Itinerary } from '$lib/types';

type CommitStop = {
  id: string; isNew?: boolean; order: number; name: string; kind: string; station_id: string;
  station_name: string; dwell_min: number; walk_min: number; direction?: string; place?: string;
  place_id?: string; osm_id?: string; address?: string; lat?: number; lon?: number; phone?: string; website?: string;
};
type CommitBody = {
  itinerary?: string; anchorStopId?: string; stops?: CommitStop[]; removed?: string[];
  bulletin?: { id: string; kind: BulletinKind; body: string } | null;
};

const status = (err: unknown) => (err as { status?: number }).status;

// The only write path for a locked route: reconcile, validate, apply, anchor, recompute, tell the
// crew, log. PocketBase has no cross-request transaction, so instead of pretending this is atomic
// every write is keyed by an id the editor generated and is safe to repeat: the same payload sent
// again after a failure converges on the same route, with no duplicate stop and no second Bulletin.
export const POST: RequestHandler = async ({ request }) => {
  const user = await requireUser(request);
  if (!user.is_admin) throw error(403, 'Only the Conductor can change The Route.');

  const body = (await request.json()) as CommitBody;
  const id = String(body.itinerary ?? '');
  const anchorStopId = String(body.anchorStopId ?? '');
  const stops = body.stops ?? [];
  const removed = body.removed ?? [];
  if (!/^[a-z0-9]{15}$/.test(id)) throw error(400, 'itinerary id required');
  if (!stops.length) throw error(400, 'Send the stops to save.');

  const pb = await adminPb();
  const itinerary = await pb.collection('itineraries').getOne<Itinerary>(id);
  if (itinerary.status !== 'locked') throw error(409, 'This itinerary is not The Route.');

  // 1. Reconcile. The set validated below has to be the set the recompute will plan, or this
  //    endpoint approves one route and publishes another.
  const persisted = new Set((await pb.collection('stops').getFullList({
    filter: pb.filter('itinerary = {:id}', { id }), fields: 'id'
  })).map((s) => s.id));
  const kept = stops.filter((s) => !s.isNew).map((s) => s.id);
  const accounted = new Set([...kept, ...removed]);
  const stale =
    kept.some((stopId) => !persisted.has(stopId)) ||
    removed.some((stopId) => !persisted.has(stopId)) ||
    [...persisted].some((stopId) => !accounted.has(stopId));
  if (stale) return json({ ok: false, stale: true, message: copy.routeMovedOn }, { status: 409 });

  // 2. Validate.
  const at = new Date().toISOString();
  const legs = await computeLegs({
    date: itinerary.event_date,
    startMin: parseHm(itinerary.start_time),
    anchor: anchorStopId ? { stopId: anchorStopId, at } : null,
    stops: stops.map((s) => ({ id: s.id, order: s.order, station_id: s.station_id, dwell_min: s.dwell_min, walk_min: s.walk_min }))
  });
  const blockers = cohesionBlockers({
    stops: stops.map((s) => ({ id: s.id, order: s.order, name: s.name })),
    legs, anchorStopId: anchorStopId || null
  });
  if (blockers.length) return json({ ok: false, blockers }, { status: 409 });

  // 3. The stops. Deletes first so a freed `order` cannot collide with an update.
  for (const stopId of removed) {
    try {
      await pb.collection('stops').delete(stopId);
    } catch (err) {
      // Already gone is the state we were asking for: a retry must not stop here.
      if (status(err) !== 404) throw err;
    }
  }
  const fields = (s: CommitStop) => ({
    order: s.order, name: s.name, kind: s.kind, station_id: s.station_id, station_name: s.station_name,
    dwell_min: s.dwell_min, walk_min: s.walk_min
  });
  for (const s of stops.filter((x) => !x.isNew)) await pb.collection('stops').update(s.id, fields(s));
  for (const s of stops.filter((x) => x.isNew)) {
    const created = {
      id: s.id, itinerary: id, ...fields(s), direction: s.direction ?? '', place: s.place ?? '',
      place_id: s.place_id ?? '', osm_id: s.osm_id ?? '', address: s.address ?? '', lat: s.lat ?? 0,
      lon: s.lon ?? 0, phone: s.phone ?? '', website: s.website ?? ''
    };
    try {
      await pb.collection('stops').create(created);
    } catch (err) {
      // The id came from the editor, so a collision means a previous attempt already created it.
      // Anything else is a real failure.
      const exists = await pb.collection('stops').getOne(s.id).catch(() => null);
      if (!exists) throw err;
      await pb.collection('stops').update(s.id, fields(s));
    }
  }

  // 4. The anchor, now that every stop it could point at exists.
  await pb.collection('checkins').create({ user: user.id, stop: anchorStopId, kind: 'at_stop', at });

  // 5. The legs everyone reads. The stops hooks fire their own recomputes; the per-itinerary queue
  //    serialises them and each one reads the same anchor, so they converge on this result.
  const recomputed = await recomputeItinerary(id);

  // 6. The Bulletin, under the editor's id so a retry cannot say the same thing twice.
  let broadcast: string | null = null;
  if (body.bulletin?.body) {
    const bulletin = body.bulletin;
    try {
      const created = await pb.collection('broadcasts').create({
        id: bulletin.id, itinerary: id, kind: bulletin.kind, body: bulletin.body, created_by: user.id
      });
      broadcast = created.id;
    } catch (err) {
      const exists = await pb.collection('broadcasts').getOne(bulletin.id).catch(() => null);
      if (!exists) throw err;
      broadcast = bulletin.id;
    }
  }

  // 7. The Train Sheet.
  await pb.collection('event_log').create({
    itinerary: id, kind: 'plan_edit', actor: user.id, at,
    payload: { stops: stops.length, added: stops.filter((s) => s.isNew).length, removed: removed.length, anchor: anchorStopId, broadcast, impossible: recomputed.impossible }
  });

  return json({ ok: true, anchorAt: at, legs: recomputed.legs, impossible: recomputed.impossible, broadcast });
};
