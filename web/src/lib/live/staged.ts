// The live editor's model. Every change is a new plan object rather than a write, so the Crew's
// boards keep showing the route as it stands until the Conductor saves the whole thing at once.
import type { Stop, VenueKind } from '$lib/types';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A PocketBase record id, generated here rather than by the server. A staged stop therefore has its
 * final id from the moment it is invented, which is what makes the save idempotent: a retry after a
 * half-finished commit collides with its own id instead of creating the bar twice.
 */
export function newRecordId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export type StagedStop = {
  id: string;
  /**
   * Staged in this session: the commit creates it rather than updating it. The flag is load-bearing
   * on the way out — /api/plan/commit uses it to tell "a stop I am adding" from "a stop that should
   * already exist", and refuses the save as stale if a non-new stop is missing from the database.
   */
  isNew?: boolean;
  order: number; name: string; kind: VenueKind; station_id: string; station_name: string;
  dwell_min: number; walk_min: number; direction: 'out' | 'back' | '';
  /**
   * Venue details, flattened to the field names /api/plan/commit writes on create. A stop that
   * already exists carries none of them: the commit never updates venue fields, because the live
   * editor cannot re-point a stop at a different bar.
   */
  place?: string; place_id?: string; osm_id?: string; address?: string; lat?: number; lon?: number;
  phone?: string; website?: string;
};
export type StagedPlan = { stops: StagedStop[]; anchorStopId: string | null; removed: string[] };

const renumber = (stops: StagedStop[]): StagedStop[] => stops.map((s, i) => ({ ...s, order: i + 1 }));
const sorted = (stops: StagedStop[]) => [...stops].sort((a, b) => a.order - b.order);

export function stagePlan(stops: Stop[], anchorStopId: string | null): StagedPlan {
  return {
    stops: renumber(sorted(stops.map((s) => ({
      id: s.id, order: s.order, name: s.name, kind: s.kind ?? 'bar', station_id: s.station_id,
      station_name: s.station_name, dwell_min: s.dwell_min ?? 60, walk_min: s.walk_min ?? 5,
      direction: s.direction ?? ''
    })))),
    anchorStopId,
    removed: []
  };
}

export function setDwell(plan: StagedPlan, stopId: string, dwellMin: number): StagedPlan {
  return { ...plan, stops: plan.stops.map((s) => (s.id === stopId ? { ...s, dwell_min: dwellMin } : s)) };
}

/** Only stops at the same station swap places; the line decides everything else, as in the planner. */
export function moveStop(plan: StagedPlan, stopId: string, dir: -1 | 1): StagedPlan {
  const stops = sorted(plan.stops);
  const i = stops.findIndex((s) => s.id === stopId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= stops.length || stops[i].station_id !== stops[j].station_id || stops[i].direction !== stops[j].direction) return plan;
  const next = [...stops];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...plan, stops: renumber(next) };
}

export function removeStop(plan: StagedPlan, stopId: string): StagedPlan {
  const going = plan.stops.find((s) => s.id === stopId);
  if (!going) return plan;
  return {
    ...plan,
    stops: renumber(sorted(plan.stops.filter((s) => s.id !== stopId))),
    // A staged stop was never written, so there is nothing for the server to delete.
    removed: going.isNew ? plan.removed : [...plan.removed, stopId]
  };
}

export function addStop(plan: StagedPlan, stop: Omit<StagedStop, 'id' | 'order' | 'isNew'>, index: number): StagedPlan {
  const next = sorted(plan.stops);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, { ...stop, id: newRecordId(), isNew: true, order: 0 });
  return { ...plan, stops: renumber(next) };
}

export function setAnchor(plan: StagedPlan, stopId: string): StagedPlan {
  return { ...plan, anchorStopId: stopId };
}

export function commitPayload(plan: StagedPlan, itineraryId: string) {
  return { itinerary: itineraryId, anchorStopId: plan.anchorStopId ?? '', stops: plan.stops, removed: plan.removed };
}
