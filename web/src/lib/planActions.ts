// How an itinerary screen changes a plan. The draft screens write records as they always have; the
// live editor passes a staging implementation of the same shape, so `ItineraryView` never knows
// which one it is driving.
import { goto } from '$app/navigation';
import { pb } from '$lib/pb';
import { copy } from '$lib/labels';
import type { Stop } from '$lib/types';

export type PlanActions = {
  /** Absent on the live editor: The Route's start time is fixed once the crew is riding it. */
  setStartTime?: (hm: string) => void | Promise<void>;
  setDwell: (stopId: string, dwellMin: number) => void | Promise<void>;
  move: (stopId: string, dir: -1 | 1) => void | Promise<void>;
  remove: (stopId: string) => void | Promise<void>;
  add: (stationId: string, side: 'left' | 'right') => void;
  /** Set only by the live editor: which stop the crew is standing in, and how to change it. */
  anchorStopId?: string | null;
  setAnchor?: (stopId: string) => void;
};

/** The draft behaviour: every change is a write, and the recompute hook follows it. */
export function recordActions(itineraryId: string, onerror: (message: string) => void): PlanActions {
  const fail = (err: unknown) => onerror((err as Error).message || copy.genericError);
  return {
    async setStartTime(hm) {
      try { await pb.collection('itineraries').update(itineraryId, { start_time: hm }); } catch (err) { fail(err); }
    },
    async setDwell(stopId, dwellMin) {
      try { await pb.collection('stops').update(stopId, { dwell_min: dwellMin }); } catch (err) { fail(err); }
    },
    async move(stopId, dir) {
      try {
        const stops = await pb.collection('stops').getFullList<Stop>({
          filter: pb.filter('itinerary = {:id}', { id: itineraryId }), sort: 'order,created'
        });
        const i = stops.findIndex((s) => s.id === stopId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= stops.length || stops[i].station_id !== stops[j].station_id || stops[i].direction !== stops[j].direction) return;
        const next = [...stops];
        [next[i], next[j]] = [next[j], next[i]];
        for (const [idx, s] of next.entries()) {
          if (s.order !== idx + 1) await pb.collection('stops').update(s.id, { order: idx + 1 });
        }
      } catch (err) { fail(err); }
    },
    async remove(stopId) {
      try { await pb.collection('stops').delete(stopId); } catch (err) { fail(err); }
    },
    add(stationId, side) {
      void goto(`/plan/${itineraryId}/add?station=${encodeURIComponent(stationId)}&side=${side}`);
    }
  };
}
