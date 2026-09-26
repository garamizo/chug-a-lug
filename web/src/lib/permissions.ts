// Who may change a route. Mirrors the PocketBase rules (1758860000_route_ownership.js): the
// builder, while it is a draft, or the Conductor, always. The server is the real gate; these only
// decide which controls to show.
import type { Itinerary } from './types';

type Who = { id: string; is_admin?: boolean } | null | undefined;
type Route = Pick<Itinerary, 'status' | 'created_by'>;

const ownDraft = (it: Route, who: Who) => !!who && it.status === 'draft' && it.created_by === who.id;

export const canEditStops = (it: Route, who: Who): boolean => !!who?.is_admin || ownDraft(it, who);
export const canEditSettings = canEditStops;
export const canDelete = canEditStops;
/** The Conductor editing a locked or archived route goes through the staged editor. */
export const isLockedEdit = (it: Route, who: Who): boolean => !!who?.is_admin && it.status !== 'draft';
