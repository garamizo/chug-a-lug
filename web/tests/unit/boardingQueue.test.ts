import { expect, it } from 'vitest';
import { outcomeOf, visibleRequests } from '../../src/lib/live/boardingQueue.svelte';
const r = (id: string, status: string, created: string) => ({ id, name: id, email: `${id}@x`, user_agent: '', country: '', created, status });

it('shows waiting requests, oldest first, minus the ones put off till later', () => {
  const rows = [r('b', 'waiting', '2026-10-03 10:02'), r('a', 'waiting', '2026-10-03 10:01'), r('c', 'aboard', '2026-10-03 10:00')];
  expect(visibleRequests(rows, new Set()).map((x) => x.id)).toEqual(['a', 'b']);
  expect(visibleRequests(rows, new Set(['a'])).map((x) => x.id)).toEqual(['b']);
});
it('a request another approver answered disappears on the next fetch', () => {
  expect(visibleRequests([r('a', 'turned_away', '2026-10-03 10:01')], new Set())).toEqual([]);
});
it('treats 409 as already answered, not an error (Review Focus 4)', () => {
  expect(outcomeOf(200)).toBe('done');
  expect(outcomeOf(409)).toBe('answered');
  expect(outcomeOf(500)).toBe('error');
});
