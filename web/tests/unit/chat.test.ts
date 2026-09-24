import { expect, it } from 'vitest';
import { chatEntries, reactionSummary } from '../../src/lib/live/chat';
import type { Broadcast, ChatMessage, DrinkEntry, Media, Reaction } from '../../src/lib/types';
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

it('merges messages and photos with their authors and reaction targets', () => {
  const messages = [{ id: 'm', at: '2026-12-26T17:07:00Z', body: 'On my way', user: 'u1', expand: { user: { name: 'Ana' } } }] as unknown as ChatMessage[];
  const media = [{ id: 'p', at: '2026-12-26T17:08:00Z', kind: 'image', user: 'u2', stop: 's', expand: { user: { name: 'Ben' } } }] as unknown as Media[];
  const rows = chatEntries([], [], { messages, media });
  expect(rows.map(r => [r.id, r.kind, r.author, r.target?.kind])).toEqual([
    ['message:m', 'message', 'Ana', 'message'], ['photo:p', 'photo', 'Ben', 'media']
  ]);
  expect(rows[1].media?.id).toBe('p');
});
it('falls back to creation time for Freight saved before it had an event time', () => {
  const media = [{ id: 'old', created: '2026-12-26T17:00:00Z', kind: 'image', user: 'u' }] as unknown as Media[];
  expect(chatEntries([], [], { media })[0].at).toBe('2026-12-26T17:00:00Z');
});
it('counts Cheers per entry and remembers which one is mine', () => {
  const rows = [
    { id: 'r1', user: 'me', target_kind: 'drink', target_id: 'd' },
    { id: 'r2', user: 'you', target_kind: 'drink', target_id: 'd' },
    { id: 'r3', user: 'you', target_kind: 'message', target_id: 'm' }
  ] as Reaction[];
  const summary = reactionSummary(rows, 'me');
  expect(summary.get('drink:d')).toEqual({ count: 2, mine: 'r1' });
  expect(summary.get('message:m')).toEqual({ count: 1, mine: null });
  expect(summary.get('bulletin:x')).toBeUndefined();
});
