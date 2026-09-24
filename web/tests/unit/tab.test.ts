import { describe, expect, it } from 'vitest';
import { DRINK_KINDS, tally, withPending } from '../../src/lib/live/tab';
import type { DrinkEntry } from '../../src/lib/types';

const entry = (id: string, user: string, stop: string, kind: string, at: string) =>
  ({ id, user, stop, kind, at } as DrinkEntry);

const entries = [
  entry('1', 'me', 'a', 'beer', '2026-12-26T20:00:00.000Z'),
  entry('2', 'you', 'a', 'beer', '2026-12-26T20:05:00.000Z'),
  entry('3', 'me', 'a', 'shot', '2026-12-26T20:10:00.000Z'),
  entry('4', 'me', 'b', 'beer', '2026-12-26T21:00:00.000Z')
];

describe('tally', () => {
  it('counts the crew and the caller separately, for this stop only', () => {
    const t = tally(entries, 'a', 'me');
    expect(t.crew.beer).toBe(2);
    expect(t.mine.beer).toBe(1);
    expect(t.crew.shot).toBe(1);
    expect(DRINK_KINDS).not.toContain('wine');
  });

  it('names the caller’s newest entry here, for the undo', () => {
    expect(tally(entries, 'a', 'me').lastMine?.id).toBe('3');
    expect(tally(entries, 'a', 'nobody').lastMine).toBeNull();
  });

  it('has a zero for every drink kind even with no entries', () => {
    const t = tally([], 'a', 'me');
    for (const kind of DRINK_KINDS) expect(t.crew[kind]).toBe(0);
  });
});


it('undoes water after beer at a paused instant regardless of response order', () => {
  const beer = { ...entries[0], action_order: 10 };
  const water = { ...beer, id: 'water', kind: 'water' as const, action_order: 11 };
  for (const rows of [[beer, water], [water, beer]]) {
    expect(tally(rows, 'a', 'me').lastMine?.id).toBe('water');
    expect(tally(rows.filter(e => e.id !== 'water'), 'a', 'me').lastMine?.id).toBe(beer.id);
  }
});
it('uses stable created/id fallback for legacy cached ties', () => {
  const a = { ...entries[0], id: 'a', created: '2026-12-26T20:00:00Z' };
  const b = { ...a, id: 'b' };
  expect(tally([a, b], 'a', 'me').lastMine?.id).toBe('b');
  expect(tally([b, a], 'a', 'me').lastMine?.id).toBe('b');
});

it('shows taps in flight once, even after the saved row arrives first', () => {
  const saved = [{ id: 'a', kind: 'beer' }, { id: 'b', kind: 'shot' }] as DrinkEntry[];
  const pending = [{ id: 'b', kind: 'shot' }, { id: 'c', kind: 'beer' }] as DrinkEntry[];
  expect(withPending(saved, pending).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  expect(withPending(saved, [])).toBe(saved);
});
