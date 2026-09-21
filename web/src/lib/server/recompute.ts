// Rebuilds the legs of an itinerary from its stops and the static schedule. Serialized per itinerary so
// two quick edits cannot interleave their delete/create passes.
import { adminPb } from './pb';
import { parseHm } from '$lib/time';
import { activeAnchor, computeLegs, findAnchor } from './plan';
import { impossibleFromAnchor } from '$lib/live/cohesion';
import type { Itinerary, Stop } from '$lib/types';

const queues = new Map<string, Promise<unknown>>();

/**
 * Queues a recompute for one itinerary. The returned promise settles with the counts, but callers
 * may ignore it: the chain always carries its own catch, so a failure logs instead of surfacing as
 * an unhandled rejection (which would take the Node server down).
 */
export function recomputeItinerary(itineraryId: string): Promise<{ legs: number; impossible: number; impossibleFromAnchor: number }> {
  const prev = queues.get(itineraryId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => doRecompute(itineraryId));
  queues.set(itineraryId, run);
  // `run.catch(...)` marks `run` itself as handled, so a fire-and-forget caller is safe too; the
  // derived promise never rejects, so `.finally` cannot produce an unhandled rejection either.
  void run
    .catch((err) => { console.error('[recompute]', itineraryId, err); })
    .finally(() => { if (queues.get(itineraryId) === run) queues.delete(itineraryId); });
  return run;
}

async function doRecompute(itineraryId: string) {
  const pb = await adminPb();
  // A deleted draft still fires the stops after-delete hook for each cascaded stop, so a missing
  // itinerary is normal: resolve as a no-op instead of rejecting.
  let it: Itinerary;
  try {
    it = await pb.collection('itineraries').getOne<Itinerary>(itineraryId);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { legs: 0, impossible: 0, impossibleFromAnchor: 0 };
    throw err;
  }
  const stops = await pb.collection('stops').getFullList<Stop>({ filter: pb.filter('itinerary = {:id}', { id: itineraryId }), sort: 'order,created' });
  // Only the live day has an anchor; a draft has no Conductor position and plans from its start
  // time. `activeAnchor` narrows further: even a locked route plans from its start time, exactly
  // like a draft, unless the anchor's check-in was actually made on the event's own day.
  const anchor = it.status === 'locked' ? activeAnchor(it.event_date, await findAnchor(pb, itineraryId)) : null;
  const computed = await computeLegs({
    date: it.event_date, startMin: parseHm(it.start_time), anchor,
    stops: stops.map((s) => ({ id: s.id, order: s.order, station_id: s.station_id, dwell_min: s.dwell_min ?? 60, walk_min: s.walk_min ?? 5 }))
  });
  const now = new Date().toISOString();
  const old = await pb.collection('legs').getFullList({ filter: pb.filter('itinerary = {:id}', { id: itineraryId }), fields: 'id' });
  for (const leg of old) await pb.collection('legs').delete(leg.id);
  for (const leg of computed) {
    await pb.collection('legs').create({
      itinerary: itineraryId, from_stop: leg.fromStopId, to_stop: leg.toStopId, kind: leg.kind,
      ready_at: leg.readyAt, depart_at: leg.departAt, arrive_at: leg.arriveAt,
      segments: leg.segments, computed_at: now
    });
  }
  const impossible = computed.filter((l) => l.kind === 'impossible').length;
  // A leg before the anchor is history and can look as broken as it likes (`$lib/live/cohesion`'s
  // own rule, shared here): a Conductor cannot fix a train that already left, and telling them to
  // — on every subsequent save, forever — is worse than not mentioning it. `impossible` above stays
  // the true total for logging; only the anchor-filtered count is what a save reports as "broken".
  // A draft has no anchor at all — nothing is "history" yet, so every impossible leg still counts.
  const filtered = anchor
    ? impossibleFromAnchor({
        stops: stops.map((s) => ({ id: s.id, order: s.order, name: s.name })),
        legs: computed.map((l) => ({ fromStopId: l.fromStopId, toStopId: l.toStopId, kind: l.kind })),
        anchorStopId: anchor.stopId
      }).length
    : impossible;
  await pb.collection('event_log').create({ itinerary: itineraryId, kind: 'recompute', payload: { legs: computed.length, impossible, anchored: !!anchor }, at: now });
  return { legs: computed.length, impossible, impossibleFromAnchor: filtered };
}
