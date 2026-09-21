import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser } from '$lib/server/pb';
import { computeLegs, readStops } from '$lib/server/plan';
import { recomputeItinerary } from '$lib/server/recompute';
import { cohesionBlockers } from '$lib/live/cohesion';
import { copy } from '$lib/labels';
import { parseHm } from '$lib/time';
import type { BulletinKind } from '$lib/live/diff';
import type { Itinerary } from '$lib/types';

// `isNew` is load-bearing, not a hint: a genuinely new stop sent without it is treated as an
// existing one the database doesn't have, and reconcile refuses it as stale rather than creating
// it. Task 9's staged-stop model always sets it on a new stop; this type does not make it required
// only because a kept/updated stop legitimately omits it.
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

// Every write this endpoint makes carries what the editor can actually change about a stop once it
// exists. The venue fields (place, place_id, osm_id, address, lat, lon, phone, website) are set only
// on create: the live editor cannot re-point an existing stop at a different venue, so an update never
// carries them. `direction` is not a venue field — it steers which side of the line the planner draws
// the stop on, and the editor can change it on an existing stop — so it belongs in both. If the editor
// ever grows the power to re-point a stop's venue, this is the line to change.
//
// `direction` is written only when the payload actually sent it: `CommitStop.direction` is optional,
// so an editor that echoes back only the fields it changed can omit it, and defaulting a missing key
// to `''` would silently clear a value nothing asked to clear. An explicit `''` from the client still
// means "clear it" and is written as sent.
const fields = (s: CommitStop) => ({
  order: s.order, name: s.name, kind: s.kind, station_id: s.station_id, station_name: s.station_name,
  dwell_min: s.dwell_min, walk_min: s.walk_min,
  ...(s.direction === undefined ? {} : { direction: s.direction })
});

// The only write path for a locked route: reconcile, validate, apply, anchor, recompute, tell the
// crew, log. PocketBase has no cross-request transaction, so instead of pretending this is atomic
// every stop and Bulletin write is keyed by an id the editor generated and is safe to repeat: the
// same payload sent again after a failure at any step converges on the same route, with no
// duplicate stop and no second Bulletin. (The `checkins` anchor row and the `event_log` entry are
// not deduplicated the same way — a retry adds another row of each, and `at` is computed fresh per
// request, so a retry's anchor row carries a *later* moment than the one before it, not the same
// one. That is harmless, not merely tolerated: `findAnchor` sorts by `-at`, so the newest row wins,
// and it is the very moment this same request just validated the plan against and recomputed from
// — so the anchor only ever moves to where this request already proved the route works. A second
// Train Sheet line is just a duplicate entry in a log, with nothing downstream reading it twice.)
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

  // 0. Shape. The fields the planner never reads (name, kind) still have to be right before the
  //    writes start, or a bad one is only caught by PocketBase after the deletes already ran.
  const planStops = readStops(stops, { checkVenueFields: true });

  const pb = await adminPb();
  const itinerary = await pb.collection('itineraries').getOne<Itinerary>(id);
  if (itinerary.status !== 'locked') throw error(409, 'This itinerary is not The Route.');

  // 1. Reconcile. The set validated below has to be the set the recompute will plan, or this
  //    endpoint approves one route and publishes another.
  //
  //    `accounted` includes every id the editor sent, staged-new stops included — not just the ones
  //    it claims already exist. Otherwise a retry after a partial commit (say, the new stop got
  //    created but the anchor write or the recompute then failed) sees that stop in `persisted` but
  //    not in `accounted`, and refuses forever as "stale" even though the identical payload is what
  //    the editor is trying, correctly, to converge on.
  //
  //    A `removed` id that is *not* persisted is not stale, it is already-satisfied (this is the
  //    delete's half of the same retry story as the create side above): its own delete is skipped
  //    below rather than rejected here, which is also why a `removed` id belonging to another
  //    itinerary is merely ignored — never deleted — instead of refused.
  //
  //    Staleness is three things, not one: (a) a persisted stop that `accounted` (`stops` ids
  //    union `removed` ids) doesn't cover — someone added a stop this editor never saw; (b) a
  //    non-new stop the payload claims to keep or update that `persisted` does not actually hold —
  //    someone else deleted it while this editor was open. (b) is not the same shape as either
  //    retry window above: a staged-new stop always carries `isNew: true`, even on a retry, so it
  //    is excluded from this check, and this endpoint never deletes an id that also appears in
  //    `stops` (the overlap check below forbids `stops ∩ removed`), so a kept id cannot have been
  //    removed by *this* request either. Without (b), a stop another Conductor deleted would fall
  //    into the `!persisted.has` create branch below and be silently resurrected — with none of
  //    its venue fields, since this payload never carried them for a stop it thought already
  //    existed. And (c) an id repeated inside `stops`, or shared between `stops` and `removed`,
  //    which collapses into one entry in the `accounted` Set: catch that here rather than deleting
  //    a stop and then updating the now-missing record, a 404 the Conductor cannot recover from by
  //    retrying.
  const persisted = new Set((await pb.collection('stops').getFullList({
    filter: pb.filter('itinerary = {:id}', { id }), fields: 'id'
  })).map((s) => s.id));
  const stopIds = stops.map((s) => s.id);
  const kept = stops.filter((s) => !s.isNew).map((s) => s.id);
  const accounted = new Set([...stopIds, ...removed]);
  const stale =
    kept.some((stopId) => !persisted.has(stopId)) ||
    [...persisted].some((stopId) => !accounted.has(stopId)) ||
    stopIds.length + removed.length !== accounted.size;
  if (stale) return json({ ok: false, stale: true, message: copy.routeMovedOn }, { status: 409 });
  // Only a delete already reflected in the database is skipped; everything else in `removed` is a
  // real delete this request has to make.
  const toRemove = removed.filter((stopId) => persisted.has(stopId));

  // 2. Validate.
  const at = new Date().toISOString();
  const legs = await computeLegs({
    date: itinerary.event_date,
    startMin: parseHm(itinerary.start_time),
    anchor: anchorStopId ? { stopId: anchorStopId, at } : null,
    stops: planStops
  });
  const blockers = cohesionBlockers({
    stops: stops.map((s) => ({ id: s.id, order: s.order, name: s.name })),
    legs, anchorStopId: anchorStopId || null
  });
  // `message` is what `api()` on the client surfaces as the caught error's text; without it the
  // Conductor sees a bare "409 Conflict" instead of the reason (already user-facing copy).
  if (blockers.length) return json({ ok: false, blockers, message: blockers[0].message }, { status: 409 });

  // 3. The stops. Deletes first so a freed `order` cannot collide with an update. Create-versus-update
  //    is decided from `persisted` — what the database actually holds — never from the editor's
  //    `isNew` flag: the flag describes the editor's intent when it staged the stop, but only the
  //    database knows whether a previous, partially-failed attempt already created the row. That is
  //    what makes this split idempotent across a retry.
  for (const stopId of toRemove) {
    try {
      await pb.collection('stops').delete(stopId);
    } catch (err) {
      // `toRemove` was filtered to ids `persisted` held at reconcile time, so a 404 here means the
      // row vanished between that read and this write, not that the retry story above was wrong.
      // Already gone is the state we were asking for either way: a retry must not stop here.
      if (status(err) !== 404) throw err;
    }
  }
  for (const s of stops.filter((x) => persisted.has(x.id))) await pb.collection('stops').update(s.id, fields(s));
  for (const s of stops.filter((x) => !persisted.has(x.id))) {
    const created = {
      id: s.id, itinerary: id, ...fields(s), place: s.place ?? '', place_id: s.place_id ?? '',
      osm_id: s.osm_id ?? '', address: s.address ?? '', lat: s.lat ?? 0, lon: s.lon ?? 0,
      phone: s.phone ?? '', website: s.website ?? ''
    };
    try {
      await pb.collection('stops').create(created);
    } catch (err) {
      // The id came from the editor, so a collision means a previous attempt already created it —
      // but only if that record is this itinerary's. The admin client can see every itinerary's
      // stops, so an id that happens to collide with someone else's row must not be adopted.
      const exists = await pb.collection('stops').getOne<{ id: string; itinerary?: string }>(s.id).catch(() => null);
      if (!exists || exists.itinerary !== id) throw err;
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
      const exists = await pb.collection('broadcasts').getOne<{ id: string; itinerary?: string }>(bulletin.id).catch(() => null);
      if (!exists || exists.itinerary !== id) throw err;
      broadcast = bulletin.id;
    }
  }

  // 7. The Train Sheet.
  await pb.collection('event_log').create({
    itinerary: id, kind: 'plan_edit', actor: user.id, at,
    payload: { stops: stops.length, added: stops.filter((s) => s.isNew).length, removed: toRemove.length, anchor: anchorStopId, broadcast, impossible: recomputed.impossible }
  });

  // The client's `impossible` is anchor-filtered, not the raw total: a leg behind the crew is
  // history and the Conductor cannot fix it, so counting it here would tell them to on every save.
  return json({ ok: true, anchorAt: at, legs: recomputed.legs, impossible: recomputed.impossibleFromAnchor, broadcast });
};
