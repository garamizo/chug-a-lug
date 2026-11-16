// Milestones are worked out from the Tab and Freight, never stored: every phone reads the same rows,
// so every phone tells the same story, and an undone drink takes its milestone with it.
import { copy } from '$lib/labels';
import { todayInTz } from '$lib/time';
import type { ChatEntry } from './chat';
import type { DrinkEntry, Media, Stop } from '$lib/types';

const TOTALS = [10, 25, 50, 100];
const ALCOHOL = new Set(['shot', 'cocktail', 'beer']);

type Trigger = { at: string; created?: string; order: number };
const note = (id: string, t: Trigger, body: string): ChatEntry => ({
  id: `milestone:${id}`, at: t.at, created: t.created ?? '', order: t.order + 0.5,
  author: copy.milestoneAuthor, userId: '', stop: '', kind: 'milestone', body, target: null
});

export const drinkOrder = (a: DrinkEntry, b: DrinkEntry) => Date.parse(a.at) - Date.parse(b.at)
  || (a.action_order ?? 0) - (b.action_order ?? 0) || (a.created ?? '').localeCompare(b.created ?? '') || a.id.localeCompare(b.id);

export function milestones(drinks: DrinkEntry[], media: Media[], stops: Pick<Stop, 'id' | 'name'>[], date: string): ChatEntry[] {
  const out: ChatEntry[] = [];
  let crewTotal = 0;

  for (const d of drinks.filter((x) => todayInTz(new Date(x.at)) === date).sort(drinkOrder)) {
    const t = { at: d.at, created: d.created, order: d.action_order ?? 0 };
    if (ALCOHOL.has(d.kind)) {
      crewTotal += 1;
      if (TOTALS.includes(crewTotal)) out.push(note(`total:${crewTotal}`, t, `🎉 ${copy.milestoneTotalBefore} ${crewTotal} ${copy.milestoneTotalAfter}`));
    }
  }

  const names = new Map(stops.map((s) => [s.id, s.name]));
  const firstPhoto = new Set<string>();
  const dayMedia = media.filter((m) => m.stop && !m.drink_kind && todayInTz(new Date(m.at || m.created)) === date)
    .sort((a, b) => Date.parse(a.at || a.created) - Date.parse(b.at || b.created) || a.id.localeCompare(b.id));
  for (const m of dayMedia) {
    if (firstPhoto.has(m.stop)) continue;
    firstPhoto.add(m.stop);
    out.push(note(`photo:${m.stop}`, { at: m.at || m.created, created: m.created, order: 0.5 },
      `📸 ${copy.milestonePhoto} ${names.get(m.stop) ?? ''} · ${m.expand?.user?.name || copy.chatCrew}`));
  }
  return out;
}
