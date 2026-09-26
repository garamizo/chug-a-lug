// The small photo on a stop card: the venue's first Google photo, when the server has fetched one.
import { pb } from '$lib/pb';
import type { Stop } from '$lib/types';

export function stopPhoto(stop: Pick<Stop, 'expand'>): string | null {
  const place = stop.expand?.place;
  const file = place?.photos?.[0];
  return place && file ? pb.files.getURL(place, file, { thumb: '400x300' }) : null;
}

/** By stop id, for screens that render staged copies of the saved stops. */
export function stopPhotos(stops: Stop[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of stops) { const url = stopPhoto(s); if (url) out[s.id] = url; }
  return out;
}
