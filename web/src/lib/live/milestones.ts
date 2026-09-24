// Milestones are worked out from the Tab and Freight, never stored: every phone reads the same rows,
// so every phone tells the same story, and an undone drink takes its milestone with it.
import { copy, drinkIcons } from '$lib/labels';
import { todayInTz } from '$lib/time';
import { compareScores, type CrewScore } from './crew';
import { DRINK_KINDS } from './tab';
import type { ChatEntry } from './chat';
import type { DrinkEntry, Media, Stop } from '$lib/types';

const TOTALS = [10, 25, 50, 100];
const ALCOHOL = new Set(['shot', 'cocktail', 'beer']);

type Trigger = { at: string; created?: string; order: number };
const note = (id: string, t: Trigger, body: string): ChatEntry => ({
  id: `milestone:${id}`, at: t.at, created: t.created ?? '', order: t.order + 0.5,
  author: copy.milestoneAuthor, userId: '', stop: '', kind: 'milestone', body, target: null
});

const drinkOrder = (a: DrinkEntry, b: DrinkEntry) => Date.parse(a.at) - Date.parse(b.at)
  || (a.action_order ?? 0) - (b.action_order ?? 0) || (a.created ?? '').localeCompare(b.created ?? '') || a.id.localeCompare(b.id);

export function milestones(drinks: DrinkEntry[], media: Media[], stops: Pick<Stop, 'id' | 'name'>[], date: string): ChatEntry[] {
  const out: ChatEntry[] = [];
  const seen = new Set<string>();
  const scores = new Map<string, CrewScore>();
  let crewTotal = 0, leader: string | null = null, leadChanges = 0;

  for (const d of drinks.filter((x) => todayInTz(new Date(x.at)) === date).sort(drinkOrder)) {
    const who = d.expand?.user?.name || copy.chatCrew;
    const t = { at: d.at, created: d.created, order: d.action_order ?? 0 };
    const kindName = (copy as Record<string, string>)[`drink_${d.kind}`] ?? copy.chatDrink;
    if (DRINK_KINDS.includes(d.kind) && !seen.has(d.kind)) {
      seen.add(d.kind);
      out.push(note(`first:${d.kind}`, t, `${drinkIcons[d.kind] ?? '☕'} ${copy.milestoneFirst} ${kindName} · ${who}`));
    }
    if (ALCOHOL.has(d.kind)) {
      crewTotal += 1;
      if (TOTALS.includes(crewTotal)) out.push(note(`total:${crewTotal}`, t, `🎉 ${copy.milestoneTotalBefore} ${crewTotal} ${copy.milestoneTotalAfter}`));
    }
    const score = scores.get(d.user) ?? { shot: 0, cocktail: 0, beer: 0, water: 0, food: 0 };
    if (Object.hasOwn(score, d.kind)) score[d.kind as keyof CrewScore] += 1;
    scores.set(d.user, score);
    // Only the person who just drank can have overtaken anyone.
    if (leader === null) leader = d.user;
    else if (d.user !== leader && compareScores(score, scores.get(leader)!) < 0) {
      leader = d.user;
      out.push(note(`lead:${++leadChanges}`, t, `👑 ${who} ${copy.milestoneLead}`));
    }
  }

  const names = new Map(stops.map((s) => [s.id, s.name]));
  const firstPhoto = new Set<string>();
  const dayMedia = media.filter((m) => m.stop && todayInTz(new Date(m.at || m.created)) === date)
    .sort((a, b) => Date.parse(a.at || a.created) - Date.parse(b.at || b.created) || a.id.localeCompare(b.id));
  for (const m of dayMedia) {
    if (firstPhoto.has(m.stop)) continue;
    firstPhoto.add(m.stop);
    out.push(note(`photo:${m.stop}`, { at: m.at || m.created, created: m.created, order: 0 },
      `📸 ${copy.milestonePhoto} ${names.get(m.stop) ?? ''} · ${m.expand?.user?.name || copy.chatCrew}`));
  }
  return out;
}
