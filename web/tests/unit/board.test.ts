import { describe, expect, it } from 'vitest';
import { BUFFER_MIN, WARNING_MIN, boardState, pickTrip } from '../../src/lib/live/board';
import type { NextTrip } from '../../src/lib/types';

const trip = (tripId: string, depart: string): NextTrip => ({
  tripId, routeId: 'BNSF', headsign: 'Chicago', schedDepart: depart, schedArrive: depart,
  liveDepart: depart, liveArrive: depart, delayMin: 0, status: 'live'
});

const state = (nowIso: string, departIso = '2026-12-26T20:31:00.000Z', walkMin = 5) =>
  boardState({ departAt: new Date(departIso), walkMin, now: new Date(nowIso) });

describe('boardState', () => {
  it('subtracts the walk and the buffer to get the leave time', () => {
    const r = state('2026-12-26T19:00:00.000Z');
    // 20:31 minus 5 min walk minus 3 min buffer.
    expect(r.leaveAt.toISOString()).toBe('2026-12-26T20:23:00.000Z');
    expect(r.departsInMin).toBe(83);
    expect(r.state).toBe('normal');
  });

  it('is normal just outside the warning window', () => {
    // leaveAt 20:23; 10 min before is 20:13.
    expect(state('2026-12-26T20:12:00.000Z').state).toBe('normal');
  });

  it('warns from the threshold inwards', () => {
    expect(state('2026-12-26T20:13:00.000Z').state).toBe('warning');
    expect(state('2026-12-26T20:22:00.000Z').state).toBe('warning');
  });

  it('says leave now at the leave time and after it', () => {
    expect(state('2026-12-26T20:23:00.000Z').state).toBe('leave_now');
    expect(state('2026-12-26T20:30:00.000Z').state).toBe('leave_now');
  });

  it('reports the train missed once it has departed', () => {
    expect(state('2026-12-26T20:32:00.000Z').state).toBe('missed');
  });

  it('uses the documented constants', () => {
    expect(BUFFER_MIN).toBe(3);
    expect(WARNING_MIN).toBe(10);
  });

  it('clamps a zero walk without going negative on the countdown', () => {
    const r = state('2026-12-26T20:31:00.000Z', '2026-12-26T20:31:00.000Z', 0);
    expect(r.state).toBe('leave_now');
    expect(r.departsInMin).toBeLessThanOrEqual(0);
  });
});

describe('pickTrip', () => {
  it('picks the first trip that has not departed', () => {
    const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
    expect(pickTrip(trips, new Date('2026-12-26T20:30:00.000Z'))?.tripId).toBe('T2');
  });

  it('keeps the current trip while it is still catchable', () => {
    const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
    expect(pickTrip(trips, new Date('2026-12-26T19:00:00.000Z'))?.tripId).toBe('T1');
  });

  it('falls back to the scheduled time when there is no live one', () => {
    const t = { ...trip('T1', '2026-12-26T20:00:00.000Z'), liveDepart: null };
    expect(pickTrip([t], new Date('2026-12-26T19:00:00.000Z'))?.tripId).toBe('T1');
  });

  it('returns null when every trip has gone', () => {
    expect(pickTrip([trip('T1', '2026-12-26T20:00:00.000Z')], new Date('2026-12-26T21:00:00.000Z'))).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickTrip([], new Date())).toBeNull();
  });
});
