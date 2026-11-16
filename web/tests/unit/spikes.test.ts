import { describe, expect, it } from 'vitest';
import { spikes, spikeTally, SPIKE_LABELS, type SpikeInput } from '../../src/lib/live/spikes';
import { copy } from '../../src/lib/labels';
import type { ChatMessage, DrinkEntry, Media } from '../../src/lib/types';

const DATE = '2026-12-26';
const at = (minute: number, hour = 20) => `2026-12-26T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
let n = 0;
const drink = (user: string, kind: string, minute: number, stop = 's1', id = `d${++n}`) => ({
  id, user, kind, stop, at: at(minute), created: '', action_order: n, expand: { user: { name: user.toUpperCase() } }
}) as unknown as DrinkEntry;
const msg = (user: string, minute: number, id = `m${++n}`) => ({
  id, user, body: 'hi', at: at(minute), created: '', expand: { user: { name: user.toUpperCase() } }
}) as unknown as ChatMessage;
const photo = (user: string, minute: number, extra: Record<string, unknown> = {}, id = `p${++n}`) => ({
  id, user, kind: 'image', at: at(minute), created: '', stop: 's1', drink_kind: '', expand: { user: { name: user.toUpperCase() } }, ...extra
}) as unknown as Media;
const STOPS = [{ id: 's1', station_id: 'A' }, { id: 's2', station_id: 'A' }, { id: 's3', station_id: 'B' }];
const input = (o: Partial<SpikeInput> = {}): SpikeInput => ({ drinks: [], media: [], messages: [], stops: STOPS, date: DATE, closedAt: null, ...o });
const of = (events: ReturnType<typeof spikes>, kind: string) => events.filter((e) => e.kind === kind);

describe('spikes', () => {
  it('pathfinder goes to the first of each kind', () => {
    const ev = of(spikes(input({ drinks: [drink('a', 'beer', 1, 's1', 'x1'), drink('b', 'beer', 2, 's1', 'x2'), drink('b', 'food', 3, 's1', 'x3')] })), 'pathfinder');
    expect(ev.map((e) => [e.id, e.user, e.name, e.detail])).toEqual([
      ['spike:pathfinder:beer:x1', 'a', 'A', 'beer'], ['spike:pathfinder:food:x3', 'b', 'B', 'food']
    ]);
    expect(ev[0].at).toBe(at(1));
  });

  it('big boy needs three drinks and passes only on a strict overtake', () => {
    const drinks = [
      drink('a', 'beer', 1), drink('a', 'water', 2), drink('a', 'beer', 3),
      drink('b', 'beer', 4), drink('b', 'beer', 5), drink('b', 'shot', 6, 's1', 'b3'),
      drink('a', 'cocktail', 7, 's1', 'a3'),
      drink('b', 'beer', 8, 's1', 'b4')
    ];
    const ev = of(spikes(input({ drinks })), 'bigboy');
    // a has only 2 alcoholic drinks at minute 3 (water does not count), so b takes it first at b3.
    expect(ev.map((e) => [e.id, e.user, e.from])).toEqual([
      ['spike:bigboy:b3', 'b', undefined]
    ]);
    const more = [...drinks, drink('a', 'beer', 9, 's1', 'a4'), drink('a', 'beer', 10, 's1', 'a5')];
    const ev2 = of(spikes(input({ drinks: more })), 'bigboy');
    // a ties b at 4 (no change), then a overtakes at 5 > 4.
    expect(ev2.map((e) => [e.id, e.user, e.from])).toEqual([['spike:bigboy:b3', 'b', undefined], ['spike:bigboy:a5', 'a', 'b']]);
  });

  it('a tie stays with the holder', () => {
    const drinks = [drink('a', 'beer', 1), drink('a', 'beer', 2), drink('a', 'beer', 3, 's1', 'a3'),
      drink('b', 'beer', 4), drink('b', 'beer', 5), drink('b', 'beer', 6)];
    expect(of(spikes(input({ drinks })), 'bigboy').map((e) => e.user)).toEqual(['a']);
  });

  it('whistle stop and railfan use the same held rule', () => {
    const messages = [...[1, 2, 3, 4].map((m) => msg('a', m)), msg('a', 5, 'a5'), ...[6, 7, 8, 9, 10].map((m) => msg('b', m)), msg('b', 11, 'b6')];
    const ws = of(spikes(input({ messages })), 'whistlestop');
    expect(ws.map((e) => [e.id, e.user, e.from])).toEqual([['spike:whistlestop:a5', 'a', undefined], ['spike:whistlestop:b6', 'b', 'a']]);
    const media = [photo('a', 1), photo('a', 2), photo('a', 3, {}, 'a3'), photo('b', 4), photo('b', 5), photo('b', 6), photo('b', 7, {}, 'b4')];
    const rf = of(spikes(input({ media })), 'railfan');
    expect(rf.map((e) => [e.id, e.user, e.from])).toEqual([['spike:railfan:a3', 'a', undefined], ['spike:railfan:b4', 'b', 'a']]);
  });

  it('railfan counts images that are not drink photos', () => {
    const media = [photo('a', 1, { drink_kind: 'beer' }), photo('a', 2, { kind: 'video' }), photo('a', 3), photo('a', 4)];
    expect(of(spikes(input({ media })), 'railfan')).toEqual([]);
    const third = photo('a', 6, {}, 'third');
    expect(of(spikes(input({ media: [...media, photo('a', 5, { drink_kind: 'shot' }), third] })), 'railfan').map((e) => e.id)).toEqual(['spike:railfan:third']);
  });

  it('triple header counts three drinks at one station across two stops', () => {
    const drinks = [drink('a', 'beer', 1, 's1'), drink('a', 'beer', 2, 's2'), drink('a', 'water', 3, 's1'), drink('a', 'beer', 4, 's2', 't3'),
      drink('a', 'beer', 5, 's3'), drink('a', 'beer', 6, 's2', 'ignored'), drink('a', 'beer', 7, 'gone')];
    const ev = of(spikes(input({ drinks })), 'triple');
    expect(ev.map((e) => [e.id, e.detail])).toEqual([['spike:triple:a:A:t3', 'A']]);
  });

  it('full consist completes all five kinds', () => {
    const drinks = ['shot', 'cocktail', 'beer', 'water', 'beer', 'food'].map((k, i) => drink('a', k, i + 1, 's1', `f${i}`));
    expect(of(spikes(input({ drinks })), 'fullconsist').map((e) => [e.id, e.at])).toEqual([['spike:fullconsist:a:f5', at(6)]]);
    expect(of(spikes(input({ drinks: drinks.slice(0, 5) })), 'fullconsist')).toEqual([]);
  });

  it('caboose waits for closing time, counts takers-part only, and ties share it', () => {
    const drinks = [drink('a', 'beer', 1), drink('a', 'beer', 2), drink('b', 'beer', 3), drink('c', 'water', 4), drink('d', 'food', 5), drink('b', 'beer', 6)];
    expect(of(spikes(input({ drinks })), 'caboose')).toEqual([]);
    const closedAt = at(0, 23);
    const ev = of(spikes(input({ drinks, closedAt })), 'caboose');
    expect(ev.map((e) => [e.id, e.user, e.at])).toEqual([['spike:caboose:c', 'c', closedAt], ['spike:caboose:d', 'd', closedAt]]);
    // someone with no Tab entry at all (only a message) is not a taker-part
    expect(of(spikes(input({ drinks: [drink('a', 'beer', 1)], messages: [msg('z', 2)], closedAt })), 'caboose').map((e) => e.user)).toEqual(['a']);
  });

  it('rows after closing time do not count', () => {
    const drinks = [drink('a', 'beer', 1), drink('a', 'beer', 2), drink('a', 'beer', 30, 's1', 'late')];
    const closedAt = at(10);
    const ev = spikes(input({ drinks, closedAt }));
    expect(ev.some((e) => e.id.includes('late'))).toBe(false);
    expect(of(ev, 'bigboy')).toEqual([]);
    expect(of(spikes(input({ drinks })), 'bigboy').map((e) => e.id)).toEqual(['spike:bigboy:late']);
  });

  it('other days are ignored', () => {
    const other = { ...drink('a', 'beer', 1), at: '2026-12-25T20:00:00Z' } as DrinkEntry;
    const otherMsg = { ...msg('a', 1), at: '2026-12-25T20:00:00Z' } as ChatMessage;
    expect(spikes(input({ drinks: [other], messages: [otherMsg] }))).toEqual([]);
  });

  it('ids survive deleting an earlier row', () => {
    const drinks = [drink('a', 'water', 0, 's1', 'e0'), drink('a', 'beer', 1, 's1', 'e1'), drink('a', 'beer', 2, 's1', 'e2'), drink('a', 'beer', 3, 's1', 'e3'), drink('b', 'beer', 4, 's1', 'e4'),
      drink('b', 'beer', 5, 's1', 'e5'), drink('b', 'beer', 6, 's1', 'e6'), drink('b', 'beer', 7, 's1', 'e7')];
    const ids = (d: DrinkEntry[]) => spikes(input({ drinks: d })).map((e) => e.id);
    const before = ids(drinks);
    expect(before).toContain('spike:bigboy:e7');
    expect(ids(drinks.filter((d) => d.id !== 'e0'))).toContain('spike:bigboy:e7');
    expect(ids(drinks.filter((d) => d.id !== 'e0'))).toContain('spike:triple:b:A:e6');
    expect(ids(drinks.filter((d) => d.id !== 'e2'))).toContain('spike:triple:b:A:e6');
  });

  it('shuffled input gives the same spikes', () => {
    const drinks = [drink('a', 'beer', 1), drink('b', 'beer', 1), drink('a', 'shot', 2), drink('b', 'water', 3), drink('a', 'cocktail', 4), drink('b', 'beer', 5), drink('b', 'beer', 6)];
    const messages = [1, 2, 3, 4, 5, 6].map((m) => msg(m % 2 ? 'a' : 'b', m));
    const media = [1, 2, 3, 4].map((m) => photo('a', m));
    const base = spikes(input({ drinks, messages, media, closedAt: at(0, 23) }));
    const rev = <T,>(x: T[]) => [...x].reverse();
    const mid = <T,>(x: T[]) => [...x.slice(2), ...x.slice(0, 2)];
    expect(spikes(input({ drinks: rev(drinks), messages: mid(messages), media: rev(media), closedAt: at(0, 23) }))).toEqual(base);
    expect(spikes(input({ drinks: mid(drinks), messages: rev(messages), media: mid(media), closedAt: at(0, 23) }))).toEqual(base);
    const sorted = [...base].sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.created.localeCompare(y.created) || x.order - y.order || x.id.localeCompare(y.id));
    expect(base).toEqual(sorted);
  });

  it('undoing the deciding drink removes its spike', () => {
    const drinks = [drink('a', 'beer', 1), drink('a', 'beer', 2), drink('a', 'beer', 3, 's1', 'deciding')];
    expect(spikes(input({ drinks })).map((e) => e.id)).toContain('spike:bigboy:deciding');
    const after = spikes(input({ drinks: drinks.slice(0, 2) }));
    expect(of(after, 'bigboy')).toEqual([]);
    expect(of(after, 'triple')).toEqual([]);
  });

  it('spikeTally counts won and currently held spikes', () => {
    const drinks = [drink('a', 'beer', 1), drink('a', 'beer', 2), drink('a', 'beer', 3), drink('b', 'beer', 4), drink('b', 'beer', 5), drink('b', 'beer', 6), drink('b', 'beer', 7),
      drink('c', 'water', 8)];
    const events = spikes(input({ drinks, closedAt: at(0, 23) }));
    const tally = spikeTally(events);
    // a: pathfinder beer, triple header; held Big Boy moved to b. b: Big Boy held. c: pathfinder water, caboose.
    expect(tally.get('a')?.sort()).toEqual(['pathfinder', 'triple'].sort());
    expect(tally.get('b')?.sort()).toEqual(['bigboy', 'triple'].sort());
    expect(tally.get('c')?.sort()).toEqual(['caboose', 'pathfinder']);
    expect(tally.has('nobody')).toBe(false);
  });

  it('labels each kind from copy', () => {
    expect(SPIKE_LABELS.bigboy).toEqual({ name: copy.spikeBigBoy, why: copy.spikeBigBoyWhy });
    expect(SPIKE_LABELS.fullconsist.name).toBe('Full Consist');
    expect(SPIKE_LABELS.triple.why).toBe('Three drinks at one station');
  });
});
