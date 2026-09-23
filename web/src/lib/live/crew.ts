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

export type CrewScore = Record<'shot' | 'cocktail' | 'beer' | 'water' | 'food', number>;
export function crewScore(drinks: DrinkEntry[], userId: string, date: string): CrewScore {
  const score: CrewScore = { shot: 0, cocktail: 0, beer: 0, water: 0, food: 0 };
  for (const drink of drinks) {
    if (drink.user === userId && todayInTz(new Date(drink.at)) === date && Object.hasOwn(score, drink.kind)) {
      score[drink.kind as keyof CrewScore]++;
    }
  }
  return score;
}
export function compareScores(a: CrewScore, b: CrewScore): number {
  return (b.shot + b.cocktail + b.beer) - (a.shot + a.cocktail + a.beer) || b.water - a.water || b.food - a.food;
}
