import { describe, expect, it } from 'vitest';
import { eventTimeAt, readClockState, transitionClock, type ClockState } from '../../src/lib/sim/clock';
import vectors from '../fixtures/sim/clock-vectors.json';

export const clock: ClockState = {
  runId: 'fixture-one', revision: 1, epochStart: '2026-12-26T18:00:00.000Z',
  wallStart: '2026-09-21T12:00:00.000Z', rate: 0, resumeRate: 1,
  serviceDate: '2026-12-26', source: 'timetable', recordingId: null,
  windowStart: '2026-12-26T06:00:00.000Z', windowEnd: '2026-12-27T04:00:00.000Z'
};
const wall = new Date('2026-09-21T12:00:10.000Z');

describe('simulation clock', () => {
  it.each(vectors)('$name', (v) => {
    expect(eventTimeAt({ ...clock, ...v.state }, new Date(v.wallNow)).toISOString()).toBe(v.eventNow);
  });
  it('validates and copies persisted state', () => {
    const parsed = readClockState(clock);
    expect(parsed).toEqual(clock);
    expect(parsed).not.toBe(clock);
  });
  it.each([
    { rate: NaN }, { rate: Infinity }, { rate: -1 }, { rate: 2 }, { resumeRate: 0 },
    { revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { epochStart: '2026-02-30T18:00:00.000Z' }, { serviceDate: '2026-02-30' },
    { wallStart: '2026-09-21T12:00:00' }, { windowEnd: clock.windowStart },
    { epochStart: '2026-12-28T18:00:00.000Z' }, { runId: '../live' },
    { source: 'recording', recordingId: null }, { source: 'timetable', recordingId: 'some-feed' }
  ])('rejects corrupt state %j', (patch) => {
    expect(() => readClockState({ ...clock, ...patch })).toThrow();
  });
  it('changes rate without jumping and increments revision once', () => {
    const running = { ...clock, rate: 5 as const };
    const updated = transitionClock(running, { action: 'rate', rate: 10 }, wall);
    expect(updated).toMatchObject({ epochStart: '2026-12-26T18:00:50.000Z', rate: 10, resumeRate: 10, revision: 2 });
    expect(eventTimeAt(updated, new Date(wall.getTime() + 1000)).toISOString()).toBe('2026-12-26T18:01:00.000Z');
    expect(running.epochStart).toBe(clock.epochStart);
  });
  it('pause remembers speed and resume includes no paused elapsed time', () => {
    const paused = transitionClock({ ...clock, rate: 30 }, { action: 'pause' }, wall);
    expect(paused).toMatchObject({ rate: 0, resumeRate: 30, epochStart: '2026-12-26T18:05:00.000Z' });
    const resumed = transitionClock(paused, { action: 'resume' }, new Date(wall.getTime() + 60_000));
    expect(resumed).toMatchObject({ rate: 30, epochStart: paused.epochStart });
  });
  it('selecting speed while paused stays paused until resume', () => {
    const updated = transitionClock(clock, { action: 'rate', rate: 60 }, wall);
    expect(updated).toMatchObject({ rate: 0, resumeRate: 60 });
    expect(transitionClock(updated, { action: 'resume' }, wall).rate).toBe(60);
  });
  it('seeks forward only while paused, including the exact end', () => {
    const updated = transitionClock(clock, { action: 'seek', at: clock.windowEnd }, wall);
    expect(updated).toMatchObject({ epochStart: clock.windowEnd, rate: 0 });
    expect(transitionClock(updated, { action: 'resume' }, wall).rate).toBe(0);
  });
  it.each([
    { action: 'seek', at: '2026-12-26T17:00:00Z' },
    { action: 'seek', at: '2026-12-27T05:00:00Z' },
    { action: 'seek', at: '2026-02-30T18:00:00Z' },
    { action: 'rate', rate: 0 }, { action: 'rate', rate: Infinity },
    { action: 'rate', rate: '10' }, { action: 'warp' }, null
  ])('refuses invalid control %j', (command) => {
    expect(() => transitionClock(clock, command, wall)).toThrow();
  });
  it('refuses a seek on a running clock', () => {
    expect(() => transitionClock({ ...clock, rate: 1 }, { action: 'seek', at: clock.windowEnd }, wall)).toThrow();
  });
  it('rejects invalid wall instants and revision overflow', () => {
    expect(() => eventTimeAt(clock, new Date(NaN))).toThrow();
    expect(() => transitionClock({ ...clock, revision: Number.MAX_SAFE_INTEGER }, { action: 'pause' }, wall)).toThrow();
  });
});
