// The planner's departure board: counts, status chips, order, and the delete confirmation.
import { pb } from './pb';
import { copy } from './labels';
import type { Chip } from './home';
import type { Itinerary } from './types';

export function countBy(ids: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function routeChip(it: Pick<Itinerary, 'status' | 'vote_open' | 'id'>, currentId: string | null): Chip {
  if (it.status === 'draft') return { text: it.vote_open ? copy.chipVoteOpen : copy.chipDraft, tone: 'go' };
  if (it.status === 'locked') return { text: it.id === currentId ? copy.chipCurrent : copy.chipLocked, tone: 'gold' };
  return { text: copy.chipArchived, tone: 'muted' };
}

export function sortRoutes<T extends Pick<Itinerary, 'status' | 'created'>>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.status === 'draft') - Number(a.status === 'draft') || String(b.created).localeCompare(String(a.created)));
}

export function deleteConfirm(it: Pick<Itinerary, 'status' | 'id' | 'event_date'>, currentId: string | null, today: string): string {
  if (it.status === 'draft') return copy.deleteDraftConfirm;
  const parts: string[] = [copy.deleteLockedConfirm];
  if (it.id === currentId) parts.push(copy.deleteCurrentConfirm);
  if (it.id === currentId && it.event_date === today) parts.unshift(copy.deleteTodayConfirm);
  return parts.join(' ');
}

/** Confirm, then delete. Returns whether the route is gone. Throws on a failed delete. */
export async function deleteRoute(it: Pick<Itinerary, 'status' | 'id' | 'event_date'>, currentId: string | null, today: string): Promise<boolean> {
  if (!confirm(deleteConfirm(it, currentId, today))) return false;
  await pb.collection('itineraries').delete(it.id);
  return true;
}
