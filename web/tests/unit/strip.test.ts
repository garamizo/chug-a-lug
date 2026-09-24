import { expect, it } from 'vitest';
import { stripStops } from '../../src/lib/live/strip';
import type { Current } from '../../src/lib/live/current';
import type { Leg, Stop } from '../../src/lib/types';

const stops = [{ id: 'b', order: 2 }, { id: 'a', order: 1 }, { id: 'c', order: 3 }] as Stop[];
const legs = [{ to_stop: 'b', arrive_at: '2026-12-26T20:00:00Z' }, { to_stop: 'c', arrive_at: '2026-12-26T22:00:00Z' }] as Leg[];
const start = new Date('2026-12-26T18:00:00Z');
const at = (id: string, source: Current['source']) => ({ stop: { id }, source } as unknown as Current);
const states = (here: Current | null) => stripStops(stops, legs, here, start).map((s) => `${s.stop.id}:${s.state}`);

it('orders stops and marks those behind the crew done', () => {
  expect(states(at('b', 'clock'))).toEqual(['a:done', 'b:current', 'c:next']);
  expect(states(at('c', 'override'))).toEqual(['a:done', 'b:done', 'c:current']);
});
it('shows nothing done before the crawl and everything done after it', () => {
  expect(states(at('a', 'before'))).toEqual(['a:next', 'b:next', 'c:next']);
  expect(states(at('c', 'after'))).toEqual(['a:done', 'b:done', 'c:done']);
  expect(states(null)).toEqual(['a:next', 'b:next', 'c:next']);
});
it('uses the start time for the first stop and leg arrivals for the rest', () => {
  expect(stripStops(stops, legs, null, start).map((s) => s.arriveAt)).toEqual(['2026-12-26T18:00:00.000Z', '2026-12-26T20:00:00Z', '2026-12-26T22:00:00Z']);
});
