import { describe, expect, it } from 'vitest';
import { countBy, deleteConfirm, routeChip, sortRoutes } from '../../src/lib/planList';
import { copy } from '../../src/lib/labels';

describe('planList', () => {
  it('counts ids', () => {
    expect([...countBy(['a', 'b', 'a'])]).toEqual([['a', 2], ['b', 1]]);
    expect(countBy([]).size).toBe(0);
  });
  it('chips each status, current first', () => {
    expect(routeChip({ id: 'x', status: 'draft', vote_open: false }, null)).toEqual({ text: 'Draft', tone: 'go' });
    expect(routeChip({ id: 'x', status: 'draft', vote_open: true }, null)).toEqual({ text: 'Vote open', tone: 'go' });
    expect(routeChip({ id: 'x', status: 'locked', vote_open: false }, 'x')).toEqual({ text: 'Current', tone: 'gold' });
    expect(routeChip({ id: 'x', status: 'locked', vote_open: false }, 'y')).toEqual({ text: 'Locked', tone: 'gold' });
    expect(routeChip({ id: 'x', status: 'archived', vote_open: false }, null)).toEqual({ text: 'Archived', tone: 'muted' });
  });
  it('drafts first, then newest', () => {
    const r = (id: string, status: 'draft' | 'locked' | 'archived', created: string) => ({ id, status, created });
    expect(sortRoutes([r('a', 'locked', '2026-09-03'), r('b', 'draft', '2026-09-01'), r('c', 'draft', '2026-09-02'), r('d', 'archived', '2026-09-04')]).map((x) => x.id))
      .toEqual(['c', 'b', 'd', 'a']);
  });
  it('warns harder for locked, current and today', () => {
    expect(deleteConfirm({ id: 'x', status: 'draft', event_date: '2026-12-26' }, null, '2026-09-25')).toBe(copy.deleteDraftConfirm);
    const locked = deleteConfirm({ id: 'x', status: 'locked', event_date: '2026-12-26' }, 'y', '2026-09-25');
    expect(locked).toBe(copy.deleteLockedConfirm);
    const current = deleteConfirm({ id: 'x', status: 'locked', event_date: '2026-12-26' }, 'x', '2026-09-25');
    expect(current).toContain(copy.deleteCurrentConfirm);
    const today = deleteConfirm({ id: 'x', status: 'locked', event_date: '2026-12-26' }, 'x', '2026-12-26');
    expect(today.startsWith(copy.deleteTodayConfirm)).toBe(true);
  });
});
