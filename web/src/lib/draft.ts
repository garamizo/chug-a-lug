// Loading and following one itinerary with its stops and legs, shared by the draft's view and
// edit screens (and anything else that shows a draft).
import { pb, subscribe } from './pb';
import type { Itinerary, Leg, Stop } from './types';

export type Draft = { itinerary: Itinerary; stops: Stop[]; legs: Leg[] };

export async function loadDraft(id: string): Promise<Draft> {
  const filter = pb.filter('itinerary = {:id}', { id });
  const [itinerary, stops, legs] = await Promise.all([
    pb.collection('itineraries').getOne<Itinerary>(id),
    pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created' }),
    pb.collection('legs').getFullList<Leg>({ filter })
  ]);
  return { itinerary, stops, legs };
}

/** Calls `onchange` whenever the itinerary, its stops, or its legs change. Returns the unsubscribe. */
export function watchDraft(id: string, onchange: () => void): () => void {
  const filter = pb.filter('itinerary = {:id}', { id });
  const unsubs = [subscribe('stops', filter, onchange), subscribe('legs', filter, onchange), subscribe('itineraries', pb.filter('id = {:id}', { id }), onchange)];
  return () => unsubs.forEach((u) => u());
}
