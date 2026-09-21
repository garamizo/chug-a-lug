// A staged plan's leg times, in the shape the itinerary components already render. The synthetic
// ids never reach the database: a preview leg exists only for as long as the editor is open.
import { api } from '$lib/api';
import type { StagedPlan } from './staged';
import type { Leg, Segment } from '$lib/types';

type PreviewResponse = {
  anchorAt: string | null;
  legs: { fromStopId: string; toStopId: string; kind: Leg['kind']; readyAt: string; departAt: string; arriveAt: string; segments: Segment[] }[];
};

export async function previewPlan(plan: StagedPlan, itineraryId: string): Promise<Leg[]> {
  const res = await api<PreviewResponse>('/api/plan/preview', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    json: {
      itinerary: itineraryId,
      anchorStopId: plan.anchorStopId,
      stops: plan.stops.map((s) => ({ id: s.id, order: s.order, station_id: s.station_id, dwell_min: s.dwell_min, walk_min: s.walk_min }))
    }
  });
  return res.legs.map((leg) => ({
    id: `preview:${leg.fromStopId}:${leg.toStopId}`,
    itinerary: itineraryId,
    from_stop: leg.fromStopId,
    to_stop: leg.toStopId,
    kind: leg.kind,
    ready_at: leg.readyAt,
    depart_at: leg.departAt,
    arrive_at: leg.arriveAt,
    segments: leg.segments,
    computed_at: ''
  } as Leg));
}
