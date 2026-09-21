import { todayInTz } from '$lib/time';
import type { BroadcastAck, DrinkEntry } from '$lib/types';

/** The whole day's Tab across stops, bounded by Chicago's calendar day. */
export function drinkCount(drinks: DrinkEntry[], userId: string, date: string): number {
  return drinks.filter((d) => d.user === userId && todayInTz(new Date(d.at)) === date).length;
}

/** Uses everyone's acknowledgements; liveDay.ackedIds belongs only to the signed-in user. */
export function hasSeen(acks: BroadcastAck[], userId: string, bulletinId: string | null): boolean {
  return !!bulletinId && acks.some((a) => a.user === userId && a.broadcast === bulletinId);
}
