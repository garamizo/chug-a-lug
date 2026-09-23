import { expect, it } from 'vitest';
import { chatEntries } from '../../src/lib/live/chat';
import type { Broadcast, DrinkEntry } from '../../src/lib/types';
it('merges bulletin and Tab activity in event order, including names and venue', () => {
  const drinks = [{ id: 'd', at: '2026-09-19T17:06:00Z', kind: 'beer', expand: { user: { name: 'Pat' }, stop: { name: 'Tap Room' } } }] as unknown as DrinkEntry[];
  const bulletins = [{ id: 'b', at: '2026-09-19T17:05:00Z', body: 'Meet here', expand: { created_by: { name: 'Conductor' } } }] as unknown as Broadcast[];
  const rows = chatEntries(drinks, bulletins);
  expect(rows.map(r => r.id)).toEqual(['bulletin:b', 'drink:d']);
  expect(rows[1]).toMatchObject({ author: 'Pat', stop: 'Tap Room', kind: 'beer' });
  expect(chatEntries([], bulletins)).toHaveLength(1);
});
it('breaks paused-clock ties by server action order, then creation time and ID', () => {
  const rows = [{ id: 'b', kind: 'shot', at: '2026-09-19T17:05:00Z', action_order: 2 }, { id: 'a', kind: 'beer', at: '2026-09-19T17:05:00Z', action_order: 1 }] as unknown as DrinkEntry[];
  expect(chatEntries(rows, []).map(r => r.id)).toEqual(['drink:a', 'drink:b']);
});
it('keeps a later Bulletin below a drink posted at the same paused event time', () => {
  const drinks = [{ id: 'd', kind: 'beer', at: '2026-09-19T17:05:00Z', created: '2026-09-22T10:00:00Z', action_order: 5 }] as unknown as DrinkEntry[];
  const bulletins = [{ id: 'b', body: 'Board now', at: '2026-09-19T17:05:00Z', created: '2026-09-22T10:01:00Z' }] as unknown as Broadcast[];
  expect(chatEntries(drinks, bulletins).map(r => r.id)).toEqual(['drink:d', 'bulletin:b']);
});
