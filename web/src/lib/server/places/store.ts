// The `places` collection: one record per venue, shared by every stop. Only the server writes it.
import type PocketBase from 'pocketbase';
import type { Place, Venue } from '$lib/types';

export const placeRef = (v: Pick<Venue, 'source' | 'id'>) => `${v.source}:${v.id}`;

/**
 * A PocketBase client error (it carries `status` and `response`) explained for the crew, or null
 * when the error is something else. A 404 on a collection means the places migration has not run
 * on this PocketBase yet, which happens when it was started before the migration file existed.
 */
export function describePbError(err: unknown): string | null {
  const e = err as { status?: number; response?: { message?: string; data?: Record<string, { message?: string }> } };
  if (typeof e?.status !== 'number' || !e.response) return null;
  if (e.status === 404) return 'The venue store is missing on the server: restart PocketBase so the places migration runs.';
  const fields = Object.entries(e.response.data ?? {}).map(([k, v]) => `${k}: ${v?.message ?? 'invalid'}`).join('; ');
  return `The venue store refused the write (${e.status})${fields ? `: ${fields}` : e.response.message ? `: ${e.response.message}` : ''}.`;
}

export async function findPlace(pb: PocketBase, ref: string): Promise<Place | null> {
  try {
    return await pb.collection('places').getFirstListItem<Place>(pb.filter('ref = {:ref}', { ref }));
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/**
 * Creates or refreshes the basics of a venue record from a nearby / search result. Details that
 * only a Google details call provides (hours, phone, website) are kept when the venue has none.
 */
export async function upsertPlace(pb: PocketBase, v: Venue, stationId: string): Promise<Place> {
  const ref = placeRef(v);
  const basics = {
    name: v.name, kind: v.kind, lat: v.lat, lon: v.lon, address: v.address ?? '',
    rating: v.rating ?? null, rating_count: v.ratingCount ?? null,
    station_id: stationId, distance_m: v.distanceM ?? null, fetched_at: new Date().toISOString(),
    ...(v.hours ? { hours: v.hours } : {}), ...(v.phone ? { phone: v.phone } : {}), ...(v.website ? { website: v.website } : {})
  };
  const existing = await findPlace(pb, ref);
  if (existing) return pb.collection('places').update<Place>(existing.id, basics);
  return pb.collection('places').create<Place>({
    ref, source: v.source, place_id: v.source === 'google' ? v.id : '', osm_id: v.source === 'osm' ? v.id : '', ...basics
  });
}

/** PocketBase stores an empty number as 0; a Google rating is 1 to 5, so 0 means "none". */
const num = (n: number | null | undefined) => (n ? n : undefined);

export function placeToVenue(p: Place): Venue {
  return {
    source: p.source, id: p.source === 'google' ? p.place_id : p.osm_id, name: p.name, kind: p.kind || 'other',
    lat: p.lat, lon: p.lon, address: p.address || undefined, hours: p.hours ?? undefined,
    phone: p.phone || undefined, website: p.website || undefined,
    distanceM: p.distance_m ?? undefined, rating: num(p.rating), ratingCount: num(p.rating_count),
    placeRef: p.id
  };
}
