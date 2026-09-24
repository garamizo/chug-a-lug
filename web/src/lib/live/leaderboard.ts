// The one-line podium on Live: the Crew Board's own ranking, cut to three, plus you.
import { copy } from '$lib/labels';
import { todayInTz } from '$lib/time';
import { compareScores, crewScore, type CrewScore } from './crew';
import type { DrinkEntry } from '$lib/types';

export type Leader = { userId: string; name: string; total: number; me: boolean };
const alcohol = (s: CrewScore) => s.shot + s.cocktail + s.beer;

export function topLine(drinks: DrinkEntry[], me: { id: string; name: string }, date: string): Leader[] {
  const today = drinks.filter((x) => todayInTz(new Date(x.at)) === date);
  const people = new Map(today.map((x) => [x.user, x.expand?.user?.name || copy.chatCrew]));
  if (!people.size) return [];
  const ranked = [...people].map(([id, name]) => ({ id, name, score: crewScore(today, id, date) }))
    .sort((a, b) => compareScores(a.score, b.score) || a.name.localeCompare(b.name));
  const line = ranked.slice(0, 3).map((r) => ({ userId: r.id, name: r.name, total: alcohol(r.score), me: r.id === me.id }));
  if (!line.some((l) => l.me)) {
    const mine = ranked.find((r) => r.id === me.id);
    line.push({ userId: me.id, name: me.name, total: mine ? alcohol(mine.score) : 0, me: true });
  }
  return line;
}
