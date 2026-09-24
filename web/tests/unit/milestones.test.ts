import { describe, expect, it } from 'vitest';
import { milestones } from '../../src/lib/live/milestones';
import { copy } from '../../src/lib/labels';
import type { DrinkEntry, Media } from '../../src/lib/types';

const DATE = '2026-12-26';
let n = 0;
const drink = (user: string, kind: string, minute: number) => ({
  id: `d${++n}`, user, kind, at: `2026-12-26T20:${String(minute).padStart(2, '0')}:00Z`, created: '', action_order: n,
  expand: { user: { name: user.toUpperCase() } }
}) as unknown as DrinkEntry;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('milestones', () => {
  it('announces the first of each kind once', () => {
    const rows = milestones([drink('a', 'beer', 1), drink('b', 'beer', 2), drink('b', 'food', 3)], [], [], DATE);
    expect(ids(rows).filter((id) => id.includes('first'))).toEqual(['milestone:first:beer', 'milestone:first:food']);
    expect(rows.find((r) => r.id === 'milestone:first:beer')?.body).toContain('A');
  });

  it('counts only shots, cocktails and beers toward crew totals, at the drink that crossed the line', () => {
    const drinks = Array.from({ length: 12 }, (_, i) => drink('a', i % 2 ? 'beer' : 'water', i));
    const rows = milestones(drinks, [], [], DATE);
    expect(ids(rows)).not.toContain('milestone:total:10');
    const more = [...drinks, ...Array.from({ length: 4 }, (_, i) => drink('a', 'shot', 20 + i))];
    const total = milestones(more, [], [], DATE).find((r) => r.id === 'milestone:total:10')!;
    expect(total.at).toBe('2026-12-26T20:23:00Z');
    expect(total.target).toBeNull();
  });

  it('reports a new leader only when someone strictly overtakes', () => {
    const rows = milestones([drink('a', 'beer', 1), drink('b', 'beer', 2), drink('b', 'shot', 3), drink('a', 'beer', 4), drink('a', 'beer', 5)], [], [], DATE);
    const leads = rows.filter((r) => r.id.startsWith('milestone:lead'));
    expect(leads.map((r) => [r.id, r.body])).toEqual([
      ['milestone:lead:1', `👑 B ${copy.milestoneLead}`], ['milestone:lead:2', `👑 A ${copy.milestoneLead}`]
    ]);
  });

  it('marks the first photo at each stop and ignores other days', () => {
    const media = [
      { id: 'p1', stop: 's1', at: '2026-12-26T20:10:00Z', created: '', user: 'a', expand: { user: { name: 'A' } } },
      { id: 'p2', stop: 's1', at: '2026-12-26T20:11:00Z', created: '', user: 'b' },
      { id: 'p3', stop: 's2', at: '2026-12-25T20:11:00Z', created: '', user: 'b' }
    ] as unknown as Media[];
    const rows = milestones([drink('a', 'beer', 1)].map((d) => ({ ...d, at: '2026-12-25T20:00:00Z' })), media, [{ id: 's1', name: 'Tap' }, { id: 's2', name: 'Hall' }], DATE);
    expect(ids(rows)).toEqual(['milestone:photo:s1']);
    expect(rows[0].body).toContain('Tap');
  });

  it('gives the same answer every time and drops a milestone when its drink is undone', () => {
    const drinks = [drink('a', 'beer', 1), drink('b', 'shot', 2)];
    expect(milestones(drinks, [], [], DATE)).toEqual(milestones([...drinks].reverse(), [], [], DATE));
    expect(ids(milestones(drinks.slice(0, 1), [], [], DATE))).not.toContain('milestone:first:shot');
  });
});
