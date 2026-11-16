// Closing Time's highlight reel, worked out from the night like Golden Spikes: nothing is stored, so every phone
// replays the same rows into the same slides.
import { copy, proofCaption } from '$lib/labels';
import { stopPhoto } from '$lib/photo';
import { todayInTz } from '$lib/time';
import { reactionSummary } from './chat';
import { stopTimings } from './current';
import type { SpikeEvent, SpikeKind } from './spikes';
import { DRINK_KINDS } from './tab';
import type { ChatMessage, DrinkEntry, DrinkKind, Leg, Media, Reaction, Stop } from '$lib/types';

export type StopWindow = { stopId: string; from: string; to: string };

export type Slide =
  | { kind: 'title'; title: string; date: string }
  | { kind: 'stop'; stopId: string; name: string; station: string; at: string; photo: string | null }
  | { kind: 'photo'; mediaId: string; cheers: number; author: string; caption: string }
  | { kind: 'message'; messageId: string; body: string; author: string; cheers: number }
  | { kind: 'spikes'; events: SpikeEvent[] }
  | { kind: 'drinks'; stopId: string; counts: Record<DrinkKind, number> }
  | { kind: 'finale'; holders: SpikeEvent[]; caboose: SpikeEvent[]; total: number };

export type ReelInput = {
  itineraryTitle: string; eventDate: string;
  stops: Stop[]; windows: StopWindow[];
  drinks: DrinkEntry[]; media: Media[]; messages: ChatMessage[]; reactions: Reaction[];
  spikes: SpikeEvent[]; date: string; closedAt: string;
};

export const REEL_DURATIONS: Record<Slide['kind'], number> = {
  title: 3000, stop: 3000, photo: 4500, message: 4000, spikes: 3500, drinks: 3000, finale: 6000
};

const PHOTOS_PER_STOP = 2;
const WON_ONCE = new Set<SpikeKind>(['pathfinder', 'triple', 'fullconsist']);
const HELD: SpikeKind[] = ['bigboy', 'whistlestop', 'railfan'];
const ALCOHOL = new Set<string>(['shot', 'cocktail', 'beer']);

/** Each stop's slice of the night, in route order: from its planned arrival to the next stop's, the last to
 *  `closedAt`. `shiftMs` moves plan times onto the activity clock (0 on the event day). */
export function stopWindows(stops: Stop[], legs: Leg[], startAt: Date, shiftMs: number, closedAt: string): StopWindow[] {
  const timings = stopTimings(stops, legs, startAt);
  const iso = (ms: number) => new Date(ms + shiftMs).toISOString();
  return timings.map((t, i) => ({
    stopId: t.stop.id,
    from: iso(t.arriveAt),
    to: i + 1 < timings.length ? iso(timings[i + 1].arriveAt) : closedAt
  }));
}

const ms = (iso: string) => Date.parse(iso);
const mediaAt = (m: Media) => m.at ?? m.taken_at;
const nameOf = (r: { expand?: { user?: { name?: string } } }) => r.expand?.user?.name || copy.chatCrew;

/** Most Cheered first, then earliest, then id: one total order, so input order never matters. */
function ranked<T extends { id: string }>(rows: T[], when: (r: T) => string, cheers: (r: T) => number): T[] {
  return [...rows].sort((a, b) => cheers(b) - cheers(a) || ms(when(a)) - ms(when(b)) || a.id.localeCompare(b.id));
}

export function buildReel(input: ReelInput): Slide[] {
  const { date, closedAt } = input;
  const limit = ms(closedAt);
  const inNight = (at: string) => todayInTz(new Date(at)) === date && ms(at) < limit;
  const cheerMap = reactionSummary(input.reactions, '');
  const cheersOf = (kind: 'media' | 'message', id: string) => cheerMap.get(`${kind}:${id}`)?.count ?? 0;

  const drinks = input.drinks.filter((d) => inNight(d.at));
  const media = input.media.filter((m) => m.kind === 'image' && inNight(mediaAt(m)));
  const messages = input.messages.filter((m) => inNight(m.at));

  const windows = new Map(input.windows.map((w) => [w.stopId, w]));
  const ordered = [...input.stops].sort((a, b) => a.order - b.order);
  const firstId = ordered[0]?.id;
  // Activity before the first arrival belongs to the first stop.
  const inWindow = (stopId: string, at: string) => {
    const w = windows.get(stopId);
    return !!w && (stopId === firstId || ms(at) >= ms(w.from)) && ms(at) < ms(w.to);
  };

  const slides: Slide[] = [{ kind: 'title', title: input.itineraryTitle, date: input.eventDate }];
  for (const stop of ordered) {
    const w = windows.get(stop.id);
    slides.push({ kind: 'stop', stopId: stop.id, name: stop.name, station: stop.station_name, at: w?.from ?? '', photo: stopPhoto(stop) });

    const mine = ranked(media.filter((m) => m.stop === stop.id), mediaAt, (m) => cheersOf('media', m.id));
    const cheered = mine.filter((m) => cheersOf('media', m.id) > 0).slice(0, PHOTOS_PER_STOP);
    for (const m of cheered.length ? cheered : mine.slice(0, 1)) {
      const author = nameOf(m);
      slides.push({ kind: 'photo', mediaId: m.id, cheers: cheersOf('media', m.id), author, caption: proofCaption(m.drink_kind || undefined, author) });
    }

    const top = ranked(messages.filter((m) => inWindow(stop.id, m.at)), (m) => m.at, (m) => cheersOf('message', m.id))[0];
    if (top && cheersOf('message', top.id) > 0) {
      slides.push({ kind: 'message', messageId: top.id, body: top.body, author: nameOf(top), cheers: cheersOf('message', top.id) });
    }

    const won = input.spikes
      .filter((e) => WON_ONCE.has(e.kind) && inWindow(stop.id, e.at))
      .sort((a, b) => ms(a.at) - ms(b.at) || a.order - b.order || a.id.localeCompare(b.id));
    if (won.length) slides.push({ kind: 'spikes', events: won });

    const counts = Object.fromEntries(DRINK_KINDS.map((k) => [k, 0])) as Record<DrinkKind, number>;
    let any = false;
    for (const d of drinks) if (d.stop === stop.id && d.kind in counts) { counts[d.kind] += 1; any = true; }
    if (any) slides.push({ kind: 'drinks', stopId: stop.id, counts });
  }

  // Caboose is stamped at closedAt: take spike events as given, never re-cut them.
  const chrono = [...input.spikes].sort((a, b) => ms(a.at) - ms(b.at) || a.order - b.order || a.id.localeCompare(b.id));
  const holders = HELD.flatMap((k) => chrono.filter((e) => e.kind === k).slice(-1));
  const caboose = chrono.filter((e) => e.kind === 'caboose');
  const total = drinks.filter((d) => ALCOHOL.has(d.kind)).length;
  slides.push({ kind: 'finale', holders, caboose, total });
  return slides;
}
