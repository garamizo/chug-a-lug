import { describe, expect, it } from 'vitest';
import { buildReel, stopWindows, REEL_DURATIONS, type ReelInput } from '../../src/lib/live/reel';
import type { SpikeEvent } from '../../src/lib/live/spikes';
import type { ChatMessage, DrinkEntry, Leg, Media, Reaction, Stop } from '../../src/lib/types';

const DATE = '2026-12-26';
const T = (h: number, m = 0) => `2026-12-26T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const CLOSED = T(23);
const stop = (id: string, order: number): Stop => ({ id, order, name: `Bar ${id}`, station_id: `st${id}`, station_name: `Station ${id}` } as unknown as Stop);
const leg = (from: string, to: string, depart: string, arrive: string): Leg =>
  ({ id: `${from}-${to}`, from_stop: from, to_stop: to, kind: 'train', ready_at: depart, depart_at: depart, arrive_at: arrive } as unknown as Leg);
const stops = [stop('A', 1), stop('B', 2), stop('C', 3)];
const legs = [leg('A', 'B', T(19), T(19, 20)), leg('B', 'C', T(21), T(21, 20)), leg('C', '', T(22, 30), T(23))];
const startAt = new Date(T(18));

const user = (n: string) => ({ name: n.toUpperCase() });
let n = 0;
const photo = (stopId: string, h: number, m: number, extra: Record<string, unknown> = {}, id = `p${++n}`) =>
  ({ id, user: 'u1', kind: 'image', at: T(h, m), stop: stopId, drink_kind: '', expand: { user: user('u1') }, ...extra }) as unknown as Media;
const msg = (h: number, m: number, extra: Record<string, unknown> = {}, id = `m${++n}`) =>
  ({ id, user: 'u1', body: `body ${id}`, at: T(h, m), expand: { user: user('u1') }, ...extra }) as unknown as ChatMessage;
const drink = (stopId: string, kind: string, h: number, m = 0, id = `d${++n}`) =>
  ({ id, user: 'u1', stop: stopId, kind, at: T(h, m) }) as unknown as DrinkEntry;
const cheer = (kind: 'media' | 'message', id: string, k = 1): Reaction[] =>
  Array.from({ length: k }, (_, i) => ({ id: `r${kind}${id}${i}`, user: `x${i}`, target_kind: kind, target_id: id }) as unknown as Reaction);
const spike = (kind: SpikeEvent['kind'], h: number, m: number, id = `spike:${kind}:${++n}`): SpikeEvent =>
  ({ id, kind, user: 'u1', name: 'ANA', at: T(h, m), created: '', order: 0 });

const windows = stopWindows(stops, legs, startAt, 0, CLOSED);
const base = (o: Partial<ReelInput> = {}): ReelInput => ({
  itineraryTitle: 'The Big Night', eventDate: DATE, stops, windows,
  drinks: [], media: [], messages: [], reactions: [], spikes: [], date: DATE, closedAt: CLOSED, ...o
});
const kinds = (r: ReturnType<typeof buildReel>) => r.map((s) => s.kind);

describe('stopWindows', () => {
  it('stopWindows follows stopTimings and ends at closing time', () => {
    expect(windows).toEqual([
      { stopId: 'A', from: T(18), to: T(19, 20) },
      { stopId: 'B', from: T(19, 20), to: T(21, 20) },
      { stopId: 'C', from: T(21, 20), to: CLOSED }
    ]);
  });
  it('stopWindows applies the practice shift', () => {
    const shift = 24 * 3600_000;
    const w = stopWindows(stops, legs, startAt, shift, CLOSED);
    expect(w[0].from).toBe('2026-12-27T18:00:00.000Z');
    expect(w[1].from).toBe('2026-12-27T19:20:00.000Z');
    expect(w[2].to).toBe(CLOSED);
  });
});

describe('buildReel', () => {
  it('each stop plays stop, photos, message, spikes, drinks in route order', () => {
    const p1 = photo('A', 18, 30, {}, 'pa');
    const p2 = photo('B', 20, 0, {}, 'pb');
    const m1 = msg(18, 40, {}, 'ma');
    const reel = buildReel(base({
      media: [p1, p2], messages: [m1], reactions: [...cheer('message', 'ma'), ...cheer('media', 'pb')],
      spikes: [spike('pathfinder', 18, 45)], drinks: [drink('A', 'beer', 18, 50)]
    }));
    expect(kinds(reel)).toEqual([
      'title', 'stop', 'photo', 'message', 'spikes', 'drinks', 'stop', 'photo', 'stop', 'finale'
    ]);
    expect(reel[0]).toEqual({ kind: 'title', title: 'The Big Night', date: DATE });
    expect(reel[1]).toMatchObject({ kind: 'stop', stopId: 'A', name: 'Bar A', station: 'Station A', at: T(18) });
    expect(reel[2]).toMatchObject({ kind: 'photo', mediaId: 'pa', author: 'U1', cheers: 0 });
    expect(reel[3]).toMatchObject({ kind: 'message', messageId: 'ma', body: 'body ma', author: 'U1', cheers: 1 });
    expect(reel[5]).toMatchObject({ kind: 'drinks', stopId: 'A', counts: { beer: 1, shot: 0, cocktail: 0, water: 0, food: 0 } });
  });

  it('the top two Cheered photos, ties to the earliest', () => {
    const media = [photo('A', 18, 50, {}, 'c'), photo('A', 18, 40, {}, 'b'), photo('A', 18, 30, {}, 'a'), photo('A', 18, 20, {}, 'z')];
    const reactions = [...cheer('media', 'a', 2), ...cheer('media', 'b', 2), ...cheer('media', 'c', 2), ...cheer('media', 'z', 0)];
    const photos = buildReel(base({ media, reactions })).filter((s) => s.kind === 'photo');
    expect(photos.map((s) => s.kind === 'photo' && s.mediaId)).toEqual(['a', 'b']);
  });

  it('an uncheered stop shows its first photo', () => {
    const photos = buildReel(base({ media: [photo('A', 18, 50, {}, 'late'), photo('A', 18, 20, {}, 'early')] }))
      .filter((s) => s.kind === 'photo');
    expect(photos.map((s) => s.kind === 'photo' && s.mediaId)).toEqual(['early']);
  });

  it('videos are skipped', () => {
    const reel = buildReel(base({ media: [photo('A', 18, 20, { kind: 'video' }, 'v')], reactions: cheer('media', 'v', 3) }));
    expect(kinds(reel)).not.toContain('photo');
  });

  it('the most Cheered message in the stop\'s window', () => {
    const messages = [msg(19, 25, {}, 'inB1'), msg(19, 30, {}, 'inB2'), msg(18, 30, {}, 'inA')];
    const reactions = [...cheer('message', 'inB1', 1), ...cheer('message', 'inB2', 3), ...cheer('message', 'inA', 2)];
    const slides = buildReel(base({ messages, reactions })).filter((s) => s.kind === 'message');
    expect(slides.map((s) => s.kind === 'message' && s.messageId)).toEqual(['inA', 'inB2']);
  });

  it('no uncheered message', () => {
    expect(kinds(buildReel(base({ messages: [msg(18, 30)] })))).not.toContain('message');
  });

  it('won-once spikes are grouped per stop and hand-overs are not replayed', () => {
    const a = spike('pathfinder', 18, 30);
    const b = spike('triple', 18, 40);
    const c = spike('fullconsist', 21, 30);
    const handover = { ...spike('bigboy', 18, 50), from: 'u2' };
    const reel = buildReel(base({ spikes: [c, handover, b, a] }));
    const slides = reel.filter((s) => s.kind === 'spikes');
    expect(slides).toHaveLength(2);
    expect(slides[0].kind === 'spikes' && slides[0].events.map((e) => e.kind)).toEqual(['pathfinder', 'triple']);
    expect(slides[1].kind === 'spikes' && slides[1].events.map((e) => e.kind)).toEqual(['fullconsist']);
    const fin = reel[reel.length - 1];
    expect(fin.kind === 'finale' && fin.holders.map((e) => e.kind)).toEqual(['bigboy']);
  });

  it('caboose stamped at closing time reaches the finale', () => {
    const caboose = spike('caboose', 23, 0, 'spike:caboose:z');
    const holderOld = spike('whistlestop', 19, 0, 'w1');
    const holderNew = { ...spike('whistlestop', 20, 0, 'w2'), user: 'u2', from: 'u1' };
    const reel = buildReel(base({ spikes: [caboose, holderOld, holderNew] }));
    const fin = reel[reel.length - 1];
    expect(fin.kind === 'finale' && fin.caboose.map((e) => e.id)).toEqual(['spike:caboose:z']);
    expect(fin.kind === 'finale' && fin.holders.map((e) => e.id)).toEqual(['w2']);
    expect(kinds(reel)).not.toContain('spikes');
  });

  it('drinks slide counts and is skipped when empty', () => {
    const reel = buildReel(base({ drinks: [drink('B', 'beer', 20), drink('B', 'beer', 20, 5), drink('B', 'water', 20, 6)] }));
    const slides = reel.filter((s) => s.kind === 'drinks');
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ stopId: 'B', counts: { beer: 2, water: 1, shot: 0, cocktail: 0, food: 0 } });
    const fin = reel[reel.length - 1];
    expect(fin.kind === 'finale' && fin.total).toBe(2);
  });

  it('rows at or after closing time and other days are left out', () => {
    const reel = buildReel(base({
      drinks: [drink('C', 'beer', 23), { ...drink('C', 'beer', 21, 30), at: '2026-12-25T21:30:00.000Z' } as DrinkEntry],
      media: [photo('C', 23, 0, {}, 'late')],
      messages: [msg(23, 0, {}, 'lm')], reactions: [...cheer('media', 'late'), ...cheer('message', 'lm')]
    }));
    expect(kinds(reel)).toEqual(['title', 'stop', 'stop', 'stop', 'finale']);
  });

  it('a Cheers after closing time counts', () => {
    const reel = buildReel(base({
      media: [photo('A', 18, 20, {}, 'x')],
      reactions: [{ id: 'late', user: 'u9', target_kind: 'media', target_id: 'x', created: '2026-12-27T08:00:00Z' } as unknown as Reaction]
    }));
    const p = reel.find((s) => s.kind === 'photo');
    expect(p && p.kind === 'photo' && p.cheers).toBe(1);
  });

  it('shuffled input gives the same reel', () => {
    const input = base({
      media: [photo('A', 18, 20, {}, 'a'), photo('A', 18, 30, {}, 'b'), photo('B', 20, 0, {}, 'c')],
      messages: [msg(18, 30, {}, 'm1'), msg(20, 30, {}, 'm2')],
      reactions: [...cheer('media', 'a', 2), ...cheer('media', 'b', 2), ...cheer('message', 'm1'), ...cheer('message', 'm2')],
      spikes: [spike('pathfinder', 18, 30, 'sp1'), spike('triple', 18, 40, 'sp2'), spike('caboose', 23, 0, 'sp3')],
      drinks: [drink('A', 'beer', 18, 40, 'd1'), drink('B', 'shot', 20, 0, 'd2')]
    });
    const rev = base({
      ...input, media: [...input.media].reverse(), messages: [...input.messages].reverse(),
      reactions: [...input.reactions].reverse(), spikes: [...input.spikes].reverse(), drinks: [...input.drinks].reverse()
    });
    expect(buildReel(rev)).toEqual(buildReel(input));
  });

  it('has the durations', () => {
    expect(REEL_DURATIONS).toEqual({ title: 3000, stop: 3000, photo: 4500, message: 4000, spikes: 3500, drinks: 3000, finale: 6000 });
  });
});
