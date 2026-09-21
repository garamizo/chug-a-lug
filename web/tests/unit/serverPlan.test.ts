import { describe, expect, it, vi } from 'vitest';
import { fixtureSchedule } from '../fixtures/loadFixture';

vi.mock('$lib/server/metra', () => ({ metra: { getSchedule: vi.fn(async () => fixtureSchedule()) } }));

const { activeAnchor, computeLegs, findAnchor } = await import('$lib/server/plan');

const stops = [
  { id: 's2', order: 2, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
  { id: 's3', order: 3, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
];

describe('computeLegs', () => {
  it('returns ISO times in UTC for the crawl date', async () => {
    // 11:00 local on 2026-12-26 is 17:00Z: Chicago is UTC-6 in December.
    const legs = await computeLegs({ date: '2026-12-26', startMin: 660, stops });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ fromStopId: 's2', toStopId: 's3', kind: 'train' });
    expect(legs[0].readyAt).toBe('2026-12-26T18:00:00.000Z');
    expect(legs[0].departAt).toBe('2026-12-26T18:30:00.000Z');
    expect(legs[0].arriveAt).toBe('2026-12-26T18:59:00.000Z');
  });

  it('converts train segment minutes to ISO as well', async () => {
    const legs = await computeLegs({ date: '2026-12-26', startMin: 660, stops });
    const seg = legs[0].segments[0];
    expect(seg).toMatchObject({ kind: 'train', from: 'LAGRANGE', to: 'CUS' });
    expect(seg).toMatchObject({ dep: '2026-12-26T18:30:00.000Z', arr: '2026-12-26T18:55:00.000Z' });
  });

  it('plans from the anchor when one is given', async () => {
    const legs = await computeLegs({
      date: '2026-12-26', startMin: 660, stops,
      anchor: { stopId: 's2', at: '2026-12-26T20:00:00.000Z' } // 14:00 local: too late for BN4
    });
    expect(legs[0].kind).toBe('impossible');
  });
});

describe('activeAnchor', () => {
  const anchor = { stopId: 's2', at: '2026-12-26T20:00:00.000Z' }; // 14:00 local on the event day

  it('steers the plan when the check-in was made on the event\'s own day', async () => {
    // 09:00 local on 2026-12-26 (Chicago is UTC-6 in December): still the event day.
    const now = new Date('2026-12-26T15:00:00.000Z');
    expect(activeAnchor('2026-12-26', anchor, now)).toEqual(anchor);
    const legs = await computeLegs({ date: '2026-12-26', startMin: 660, stops, anchor: activeAnchor('2026-12-26', anchor, now) });
    // Same case as computeLegs's own "plans from the anchor" test above: 14:00 local is too late for BN4.
    expect(legs[0].kind).toBe('impossible');
  });

  it('does not steer the plan when the check-in was made on a different day', async () => {
    // A Conductor opening The Route a week early to fix a bar that closed.
    const now = new Date('2026-12-19T15:00:00.000Z');
    expect(activeAnchor('2026-12-26', anchor, now)).toBeNull();
    const anchoredOffDay = await computeLegs({ date: '2026-12-26', startMin: 660, stops, anchor: activeAnchor('2026-12-26', anchor, now) });
    const unanchored = await computeLegs({ date: '2026-12-26', startMin: 660, stops });
    // Off-day it plans exactly as if there were no anchor at all — the same as a draft.
    expect(anchoredOffDay).toEqual(unanchored);
  });

  it('is null when there is no anchor to begin with', () => {
    expect(activeAnchor('2026-12-26', null, new Date('2026-12-26T15:00:00.000Z'))).toBeNull();
  });
});

describe('findAnchor', () => {
  const pbWith = (items: unknown[]) => ({
    filter: (raw: string) => raw,
    collection: () => ({ getList: async () => ({ items }) })
  }) as never;

  it('returns the newest check-in that belongs to an admin', async () => {
    const anchor = await findAnchor(pbWith([
      { stop: 'sX', at: '2026-12-26T21:00:00.000Z', expand: { user: { is_admin: false } } },
      { stop: 'sY', at: '2026-12-26T20:00:00.000Z', expand: { user: { is_admin: true } } }
    ]), 'itin1');
    expect(anchor).toEqual({ stopId: 'sY', at: '2026-12-26T20:00:00.000Z' });
  });

  it('is null when no admin has set a position', async () => {
    expect(await findAnchor(pbWith([{ stop: 'sX', at: 'x', expand: { user: { is_admin: false } } }]), 'itin1')).toBeNull();
    expect(await findAnchor(pbWith([]), 'itin1')).toBeNull();
  });

  it('ignores a row whose stop was deleted', async () => {
    expect(await findAnchor(pbWith([{ stop: '', at: 'x', expand: { user: { is_admin: true } } }]), 'itin1')).toBeNull();
  });
});
