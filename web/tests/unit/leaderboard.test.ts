import { expect, it } from 'vitest';
import { topLine } from '../../src/lib/live/leaderboard';
import type { DrinkEntry } from '../../src/lib/types';

const d = (user: string, kind = 'beer', at = '2026-12-26T20:00:00Z') => ({ user, kind, at, expand: { user: { name: user } } }) as unknown as DrinkEntry;
const me = { id: 'Zed', name: 'Zed' };

it('shows the top three by the Crew Board ranking and adds me when I am not in it', () => {
  const drinks = [d('Ana'), d('Ana'), d('Ana'), d('Ben'), d('Ben'), d('Cy'), d('Cy', 'water'), d('Dee'), d('Zed', 'food')];
  expect(topLine(drinks, me, '2026-12-26').map((l) => [l.name, l.total, l.me])).toEqual([
    ['Ana', 3, false], ['Ben', 2, false], ['Cy', 1, false], ['Zed', 0, true]
  ]);
});
it('does not repeat me when I am already on the podium', () => {
  expect(topLine([d('Zed'), d('Ana', 'water')], me, '2026-12-26').map((l) => l.name)).toEqual(['Zed', 'Ana']);
});
it('is empty when nobody logged anything today', () => {
  expect(topLine([d('Ana', 'beer', '2026-12-25T20:00:00Z')], me, '2026-12-26')).toEqual([]);
});
