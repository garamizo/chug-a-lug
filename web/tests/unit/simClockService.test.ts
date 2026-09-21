import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClockService } from '../../src/lib/server/sim/service';
import type { ClockState } from '../../src/lib/sim/clock';

const initial: ClockState = {
  runId: 'test-run', revision: 1, epochStart: '2026-12-26T18:00:00.000Z',
  wallStart: '2026-09-21T12:00:00.000Z', rate: 0, resumeRate: 1,
  serviceDate: '2026-12-26', source: 'timetable', recordingId: null,
  windowStart: '2026-12-26T06:00:00.000Z', windowEnd: '2026-12-27T07:00:00.000Z'
};
let stored: unknown, enabled: boolean, at: Date;
const read = vi.fn(async () => stored);
const write = vi.fn(async (state: ClockState) => { stored = structuredClone(state); });
const make = () => createClockService({ enabled: () => enabled, runId: () => 'test-run', read, write, now: () => at });
beforeEach(() => {
  stored = structuredClone(initial); enabled = true; at = new Date(initial.wallStart);
  vi.clearAllMocks();
});

describe('server simulation clock', () => {
  it('normal mode returns wall time and never reads simulation storage', async () => {
    enabled = false;
    const service = make();
    expect(await service.readContext()).toEqual({ enabled: false, eventNow: at.toISOString(), serverWallNow: at.toISOString() });
    expect(read).not.toHaveBeenCalled();
    await expect(service.change(1, { action: 'resume' })).rejects.toMatchObject({ status: 404 });
    expect(write).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...initial, runId: 'other-run' }, { ...initial, rate: 99 }])('rejects missing or corrupt state %j', async (row) => {
    stored = row;
    await expect(make().readContext()).rejects.toMatchObject({ status: 503 });
  });
  it('rejects storage errors without falling back to wall time', async () => {
    read.mockRejectedValueOnce(new Error('secret disk path'));
    await expect(make().readContext()).rejects.toMatchObject({ status: 503 });
  });
  it('persists before acknowledging, and a new service resumes the same clock', async () => {
    const result = await make().change(1, { action: 'resume' });
    expect(write).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ enabled: true, revision: 2, rate: 1 });
    at = new Date(at.getTime() + 60_000);
    expect(await make().readContext()).toMatchObject({ eventNow: '2026-12-26T18:01:00.000Z', revision: 2 });
  });
  it('a paused restart does not advance event time', async () => {
    at = new Date('2026-09-22T12:00:00Z');
    expect(await make().readContext()).toMatchObject({ eventNow: initial.epochStart, rate: 0 });
  });
  it('returns effective paused state at the end', async () => {
    stored = { ...initial, rate: 60 };
    at = new Date('2026-09-22T12:00:00Z');
    expect(await make().readContext()).toMatchObject({ eventNow: initial.windowEnd, rate: 0, ended: true });
  });
  it('serializes competing controllers: only one revision is accepted', async () => {
    const service = make();
    const results = await Promise.allSettled([
      service.change(1, { action: 'resume' }), service.change(1, { action: 'seek', at: initial.windowEnd })
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 409, current: { revision: 2 } } });
    expect(write).toHaveBeenCalledOnce();
  });
  it('rejects a missing revision with current state and no write', async () => {
    await expect(make().change(undefined, { action: 'resume' })).rejects.toMatchObject({ status: 409, current: { revision: 1 } });
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects invalid controls before any persistence', async () => {
    await expect(make().change(1, { action: 'rate', rate: -1 })).rejects.toMatchObject({ status: 400 });
    expect(write).not.toHaveBeenCalled();
  });
  it('does not acknowledge a failed write and the queue remains usable', async () => {
    const service = make();
    write.mockRejectedValueOnce(new Error('disk failure'));
    await expect(service.change(1, { action: 'resume' })).rejects.toMatchObject({ status: 503 });
    expect(await service.change(1, { action: 'resume' })).toMatchObject({ revision: 2 });
  });
  it('holds a publication lease across a midnight seek, but allows reads and nested recompute', async () => {
    const service = make();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const publication = service.withEventWrite(undefined, async (context) => {
      await service.withEventWrite(context.enabled ? context.revision : undefined, async (nested) => {
        expect(nested).toEqual(context);
      });
      entered();
      await blocked;
      return context.eventNow;
    });
    await ready;
    await expect(service.change(1, { action: 'seek', at: '2026-12-27T06:01:00Z' })).rejects.toMatchObject({ status: 409 });
    expect(await service.readContext()).toMatchObject({ revision: 1 });
    release();
    expect(await publication).toBe(initial.epochStart);
    expect(await service.change(1, { action: 'seek', at: '2026-12-27T06:01:00Z' })).toMatchObject({ revision: 2 });
  });
  it('rejects stale publication admission before calling the writer', async () => {
    const service = make(), publish = vi.fn();
    await service.change(1, { action: 'resume' });
    await expect(service.withEventWrite(1, publish)).rejects.toMatchObject({ status: 409 });
    expect(publish).not.toHaveBeenCalled();
  });
  it('releases its lease when a publisher throws', async () => {
    const service = make();
    await expect(service.withEventWrite(1, async () => { throw new Error('publish failed'); })).rejects.toThrow('publish failed');
    expect(await service.change(1, { action: 'resume' })).toMatchObject({ revision: 2 });
  });
});
