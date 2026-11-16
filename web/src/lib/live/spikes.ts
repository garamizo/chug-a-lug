// Golden Spikes are worked out from the night, never stored: every phone replays the same rows in the same
// canonical order, so every phone agrees, and an undone drink takes its spike with it.
import { copy } from '$lib/labels';
import { todayInTz } from '$lib/time';
import { DRINK_KINDS } from './tab';
import { drinkOrder } from './milestones';
import type { ChatMessage, DrinkEntry, Media, Stop } from '$lib/types';

export type SpikeKind = 'pathfinder' | 'bigboy' | 'caboose' | 'triple' | 'fullconsist' | 'whistlestop' | 'railfan';
export type SpikeEvent = {
  id: string; kind: SpikeKind; user: string; name: string;
  at: string; created: string; order: number;
  detail?: string; from?: string;
};
export type SpikeInput = {
  drinks: DrinkEntry[]; media: Media[]; messages: ChatMessage[];
  stops: Pick<Stop, 'id' | 'station_id'>[];
  date: string;
  closedAt: string | null;
};

export const BIG_BOY_DRINKS = 3;
export const TRIPLE_HEADER_DRINKS = 3;
export const WHISTLE_STOP_MESSAGES = 5;
export const RAILFAN_PHOTOS = 3;
export const ALCOHOL = new Set(['shot', 'cocktail', 'beer']);

export const SPIKE_LABELS: Record<SpikeKind, { name: string; why: string }> = {
  pathfinder: { name: copy.spikePathfinder, why: copy.spikePathfinderWhy },
  bigboy: { name: copy.spikeBigBoy, why: copy.spikeBigBoyWhy },
  caboose: { name: copy.spikeCaboose, why: copy.spikeCabooseWhy },
  triple: { name: copy.spikeTriple, why: copy.spikeTripleWhy },
  fullconsist: { name: copy.spikeFullConsist, why: copy.spikeFullConsistWhy },
  whistlestop: { name: copy.spikeWhistleStop, why: copy.spikeWhistleStopWhy },
  railfan: { name: copy.spikeRailfan, why: copy.spikeRailfanWhy }
};

type Placed = { at: string; created: string; order: number };
const nameOf = (r: { expand?: { user?: { name?: string } } }) => r.expand?.user?.name || copy.chatCrew;
const byTime = <T extends { id: string }>(when: (r: T) => string, created: (r: T) => string) => (a: T, b: T) =>
  Date.parse(when(a)) - Date.parse(when(b)) || created(a).localeCompare(created(b)) || a.id.localeCompare(b.id);

/** Held spikes: the first to reach `threshold` takes it, then it passes only on a strictly higher count. */
function held<T extends { id: string; user: string }>(
  kind: SpikeKind, rows: T[], threshold: number, place: (r: T) => Placed, name: (r: T) => string, out: SpikeEvent[]
) {
  const counts = new Map<string, number>();
  let holder: string | null = null;
  for (const r of rows) {
    const count = (counts.get(r.user) ?? 0) + 1;
    counts.set(r.user, count);
    if (count < threshold || r.user === holder) continue;
    if (holder === null) out.push({ id: `spike:${kind}:${r.id}`, kind, user: r.user, name: name(r), ...place(r) });
    else if (count > counts.get(holder)!) out.push({ id: `spike:${kind}:${r.id}`, kind, user: r.user, name: name(r), ...place(r), from: holder });
    else continue;
    holder = r.user;
  }
}

export function spikes(input: SpikeInput): SpikeEvent[] {
  const { date, closedAt } = input;
  const limit = closedAt === null ? Infinity : Date.parse(closedAt);
  const counts = (at: string) => todayInTz(new Date(at)) === date && Date.parse(at) < limit;
  const out: SpikeEvent[] = [];

  const drinks = input.drinks.filter((d) => counts(d.at)).sort(drinkOrder);
  const dp = (d: DrinkEntry): Placed => ({ at: d.at, created: d.created ?? '', order: (d.action_order ?? 0) + 0.5 });
  const station = new Map(input.stops.map((s) => [s.id, s.station_id]));
  const pathfound = new Set<string>();
  const alcohol: DrinkEntry[] = [];
  const kinds = new Map<string, Set<string>>();
  const perStation = new Map<string, number>();
  const fullDone = new Set<string>();
  const tabbers = new Map<string, { name: string; alcohol: number }>();

  for (const d of drinks) {
    if (!DRINK_KINDS.includes(d.kind)) continue;
    const who = tabbers.get(d.user) ?? { name: nameOf(d), alcohol: 0 };
    tabbers.set(d.user, who);
    if (!pathfound.has(d.kind)) {
      pathfound.add(d.kind);
      out.push({ id: `spike:pathfinder:${d.kind}:${d.id}`, kind: 'pathfinder', user: d.user, name: nameOf(d), ...dp(d), detail: d.kind });
    }
    if (ALCOHOL.has(d.kind)) {
      who.alcohol += 1;
      alcohol.push(d);
      const st = station.get(d.stop);
      if (st) {
        const key = `${d.user}:${st}`;
        const n = (perStation.get(key) ?? 0) + 1;
        perStation.set(key, n);
        if (n === TRIPLE_HEADER_DRINKS) out.push({ id: `spike:triple:${d.user}:${st}:${d.id}`, kind: 'triple', user: d.user, name: nameOf(d), ...dp(d), detail: st });
      }
    }
    const mine = kinds.get(d.user) ?? new Set<string>();
    kinds.set(d.user, mine.add(d.kind));
    if (mine.size === DRINK_KINDS.length && !fullDone.has(d.user)) {
      fullDone.add(d.user);
      out.push({ id: `spike:fullconsist:${d.user}:${d.id}`, kind: 'fullconsist', user: d.user, name: nameOf(d), ...dp(d) });
    }
  }
  held('bigboy', alcohol, BIG_BOY_DRINKS, dp, nameOf, out);

  const messages = input.messages.filter((m) => counts(m.at || m.created))
    .sort(byTime((m) => m.at || m.created, (m) => m.created ?? ''));
  held('whistlestop', messages, WHISTLE_STOP_MESSAGES, (m) => ({ at: m.at || m.created, created: m.created ?? '', order: 0.5 }), nameOf, out);

  const photos = input.media.filter((m) => m.kind === 'image' && !m.drink_kind && counts(m.at || m.created))
    .sort(byTime((m) => m.at || m.created, (m) => m.created ?? ''));
  held('railfan', photos, RAILFAN_PHOTOS, (m) => ({ at: m.at || m.created, created: m.created ?? '', order: 0.5 }), nameOf, out);

  if (closedAt !== null && tabbers.size) {
    const fewest = Math.min(...[...tabbers.values()].map((t) => t.alcohol));
    for (const [user, t] of tabbers) {
      if (t.alcohol === fewest) out.push({ id: `spike:caboose:${user}`, kind: 'caboose', user, name: t.name, at: closedAt, created: '', order: 0.5 });
    }
  }

  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.created.localeCompare(b.created) || a.order - b.order || a.id.localeCompare(b.id));
}

export const HELD: SpikeKind[] = ['bigboy', 'whistlestop', 'railfan'];

/** Spikes each person holds now: won-once spikes, plus held spikes whose latest hand-over is to them. */
export function spikeTally(events: SpikeEvent[]): Map<string, SpikeKind[]> {
  const latest = new Map<SpikeKind, SpikeEvent>();
  const tally = new Map<string, SpikeKind[]>();
  const add = (user: string, kind: SpikeKind) => tally.set(user, [...(tally.get(user) ?? []), kind]);
  for (const e of events) {
    if (HELD.includes(e.kind)) latest.set(e.kind, e);
    else add(e.user, e.kind);
  }
  for (const e of latest.values()) add(e.user, e.kind);
  return tally;
}
