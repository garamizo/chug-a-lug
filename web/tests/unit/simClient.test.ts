import { describe, expect, it } from 'vitest';
import { ClientClock } from '$lib/sim/clock.svelte';
const sample = (revision = 1, rate = 10) => ({ enabled: true as const, runId: 'test', revision, epochStart: '2026-12-26T18:00:00.000Z', wallStart: '2026-09-22T00:00:00.000Z', eventNow: '2026-12-26T18:00:00.000Z', serverWallNow: '2026-09-22T00:00:00.000Z', rate, resumeRate: 10, serviceDate: '2026-12-26', source: 'timetable' as const, recordingId: null, windowStart: '2026-12-26T18:00:00.000Z', windowEnd: '2026-12-27T02:00:00.000Z', ended: false });
describe('browser event clock', () => {
  it('anchors to monotonic receipt plus half transit, independent of phone wall time', () => {
    let mono = 200; const clock = new ClientClock(true, () => mono);
    clock.accept(sample(), 0, 200); mono = 1200;
    expect(clock.eventNow()?.toISOString()).toBe('2026-12-26T18:00:11.000Z');
  });
  it('never extrapolates a paused sample and clamps running time', () => {
    let mono = 0; const clock = new ClientClock(true, () => mono);
    clock.accept(sample(1, 0), 0, 200); mono = 1e9;
    expect(clock.eventNow()?.toISOString()).toBe(sample().eventNow);
    clock.accept(sample(2), mono, mono); mono += 1e9;
    expect(clock.eventNow()?.toISOString()).toBe(sample().windowEnd);
  });
  it('rejects obsolete revisions and older responses within a revision', () => {
    const clock = new ClientClock(true, () => 500);
    clock.accept(sample(2), 200, 300);
    expect(clock.accept(sample(1), 300, 400)).toBe(false);
    expect(clock.accept(sample(2), 100, 500)).toBe(false);
    expect(clock.revision).toBe(2);
  });
  it('does not fabricate event time before synchronization; reset clears mapping', () => {
    const clock = new ClientClock(true);
    expect(clock.eventNow()).toBeNull();
    clock.accept(sample(), 0, 0); clock.reset();
    expect(clock.eventNow()).toBeNull(); expect(clock.synchronized).toBe(false);
  });
});

it('adopts a conflict clock without replaying the obsolete control', async () => {
  const { vi } = await import('vitest');
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => sample(1, 0) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'conflict', clock: sample(2, 0) }) });
  vi.stubGlobal('fetch', fetcher);
  try {
    const clock = new ClientClock(true);
    await expect(clock.control({ action: 'resume' })).rejects.toThrow('conflict');
    expect(clock.revision).toBe(2); expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});

it('ignores an authenticated response that arrives after logout', async () => {
  const { vi } = await import('vitest');
  let finish!: (value: unknown) => void;
  vi.stubGlobal('fetch', () => new Promise(resolve => { finish = resolve; }));
  try {
    const clock = new ClientClock(true); const pending = clock.sync(); clock.reset();
    finish({ ok: true, json: async () => sample() }); await pending;
    expect(clock.sample).toBeNull(); expect(clock.synchronized).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});

it('does not let a late response from the previous run restore its clock', () => {
  const clock = new ClientClock(true);
  clock.accept({ ...sample(), runId: 'new-run' }, 200, 300);
  expect(clock.accept({ ...sample(9), runId: 'old-run' }, 100, 400)).toBe(false);
  expect(clock.runId).toBe('new-run');
});

it('owns one poller and disposes focus, online and offline listeners', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  const target = new EventTarget(); vi.stubGlobal('window', target);
  try {
    const clock = new ClientClock(true);
    const sync = vi.spyOn(clock, 'sync').mockResolvedValue();
    const first = clock.start(), second = clock.start();
    expect(vi.getTimerCount()).toBe(1);
    target.dispatchEvent(new Event('online')); expect(sync).toHaveBeenCalledTimes(1);
    first(); // obsolete owner cannot tear down the newer session
    await vi.advanceTimersByTimeAsync(5000); expect(sync).toHaveBeenCalledTimes(2);
    second(); expect(vi.getTimerCount()).toBe(0);
    target.dispatchEvent(new Event('focus')); expect(sync).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('requires a new user action when resync reveals that a control was based on an older revision', async () => {
  const { vi } = await import('vitest');
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => sample(2, 0) });
  vi.stubGlobal('fetch', fetcher);
  try {
    const clock = new ClientClock(true); clock.accept(sample(1, 0), 0, 0);
    await expect(clock.control({ action: 'resume' })).rejects.toThrow('Railroad Time changed');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(clock.revision).toBe(2);
  } finally { vi.unstubAllGlobals(); }
});
