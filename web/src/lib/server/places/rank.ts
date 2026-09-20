// Ordering for the "near the station" list: inside the radius, best rated first.
import type { Venue } from '$lib/types';

/**
 * Keeps venues within `radiusM` (a venue with no distance is kept) and sorts them by rating,
 * then review count, then distance. Unrated venues follow the rated ones, nearest first.
 */
export function rankNearby(venues: Venue[], radiusM: number): Venue[] {
  return venues
    .filter((v) => v.distanceM === undefined || v.distanceM <= radiusM)
    .sort((a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      (b.ratingCount ?? 0) - (a.ratingCount ?? 0) ||
      (a.distanceM ?? 0) - (b.distanceM ?? 0));
}
