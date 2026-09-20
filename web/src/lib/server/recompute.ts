// Rebuilds the legs of an itinerary from its stops and the static schedule. Serialized per itinerary so
// two quick edits cannot interleave their delete/create passes.
import { adminPb } from './pb';
import { metra } from './metra';
import { recomputeLegs } from '$lib/metra/plan';
import { localToUtc, parseHm } from '$lib/time';
import type { Itinerary, Stop } from '$lib/types';

const queues = new Map<string, Promise<unknown>>();

/**
 * Queues a recompute for one itinerary. The returned promise settles with the counts, but callers
 * may ignore it: the chain always carries its own catch, so a failure logs instead of surfacing as
 * an unhandled rejection (which would take the Node server down).
 */
export function recomputeItinerary(itineraryId: string): Promise<{ legs: number; impossible: number }> {
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
    if ((err as { status?: number }).status === 404) return { legs: 0, impossible: 0 };
    throw err;
  }
  const schedule = await metra.getSchedule();
  const stops = await pb.collection('stops').getFullList<Stop>({ filter: pb.filter('itinerary = {:id}', { id: itineraryId }), sort: 'order,created' });
  const computed = recomputeLegs(schedule, { date: it.event_date, startMin: parseHm(it.start_time) }, stops.map((s) => ({
    id: s.id, order: s.order, station_id: s.station_id, dwell_min: s.dwell_min ?? 60, walk_min: s.walk_min ?? 5
  })));
  const toIso = (m: number) => localToUtc(it.event_date, m).toISOString();
  const now = new Date().toISOString();
  const old = await pb.collection('legs').getFullList({ filter: pb.filter('itinerary = {:id}', { id: itineraryId }), fields: 'id' });
  for (const leg of old) await pb.collection('legs').delete(leg.id);
  for (const leg of computed) {
    await pb.collection('legs').create({
      itinerary: itineraryId, from_stop: leg.fromStopId, to_stop: leg.toStopId, kind: leg.kind,
      ready_at: toIso(leg.readyMin), depart_at: toIso(leg.departMin), arrive_at: toIso(leg.arriveMin),
      segments: leg.segments.map((seg) => seg.kind === 'train' ? { ...seg, dep: toIso(seg.dep), arr: toIso(seg.arr) } : seg),
      computed_at: now
    });
  }
  const impossible = computed.filter((l) => l.kind === 'impossible').length;
  await pb.collection('event_log').create({ itinerary: itineraryId, kind: 'recompute', payload: { legs: computed.length, impossible }, at: now });
  return { legs: computed.length, impossible };
}
