// Loading and following one itinerary with its stops and legs, shared by the draft's view and
// edit screens (and anything else that shows a draft).
import { pb, subscribe } from './pb';
import type { Itinerary, Leg, Stop } from './types';

export type Draft = { itinerary: Itinerary; stops: Stop[]; legs: Leg[] };

export async function loadDraft(id: string): Promise<Draft> {
  const filter = pb.filter('itinerary = {:id}', { id });
  const [itinerary, stops, legs] = await Promise.all([
    pb.collection('itineraries').getOne<Itinerary>(id),
    pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created', expand: 'place' }),
    pb.collection('legs').getFullList<Leg>({ filter })
  ]);
  return { itinerary, stops, legs };
}

/** A read started by the route's `load`, so it overlaps the page's own code loading (and starts
 *  on the tap itself when SvelteKit preloads). */
export type EarlyDraft = { id: string; at: number; read: Promise<Draft> };
const EARLY_MAX_AGE_MS = 5_000;

export function preloadDraft(id: string): EarlyDraft {
  const read = loadDraft(id);
  read.catch(() => {});
  return { id, at: Date.now(), read };
}

/** The early read if it is for this draft and recent — a preload from a hover long ago may be
 *  stale, and the page's realtime subscription only starts once it mounts. Otherwise a new read. */
export function draftFrom(early: EarlyDraft | undefined, id: string): Promise<Draft> {
  return early && early.id === id && Date.now() - early.at < EARLY_MAX_AGE_MS ? early.read : loadDraft(id);
}

/** Calls `onchange` whenever the itinerary, its stops, or its legs change. Returns the unsubscribe. */
export function watchDraft(id: string, onchange: () => void): () => void {
  const filter = pb.filter('itinerary = {:id}', { id });
  const unsubs = [subscribe('stops', filter, onchange), subscribe('legs', filter, onchange), subscribe('itineraries', pb.filter('id = {:id}', { id }), onchange)];
  return () => unsubs.forEach((u) => u());
}
