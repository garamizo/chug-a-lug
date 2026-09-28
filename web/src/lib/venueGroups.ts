// The picker lists bars first: nearby restaurants are as many as bars and would bury them.
import type { Venue } from './types';

export type VenueGroup = { kind: 'bar' | 'restaurant' | 'other'; venues: Venue[] };

export function groupByKind(venues: Venue[]): VenueGroup[] {
  const groups: VenueGroup[] = [{ kind: 'bar', venues: [] }, { kind: 'restaurant', venues: [] }, { kind: 'other', venues: [] }];
  for (const venue of venues) groups[venue.kind === 'bar' ? 0 : venue.kind === 'restaurant' ? 1 : 2].venues.push(venue);
  return groups.filter((g) => g.venues.length);
}
