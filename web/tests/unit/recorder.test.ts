import { describe, expect, it, vi } from 'vitest';
import type { RecorderConfig } from '../../src/lib/server/metra/recorder';
import { createRecorder, snapshotName } from '../../src/lib/server/metra/recorder';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { encodeFeed } from '../fixtures/rt';
const epoch = Date.parse('2026-12-26T18:00:00Z') / 1000;
function setup() {
  let at = new Date(epoch * 1000);
  const fetchImpl = vi.fn(async () => new Response(new Uint8Array(encodeFeed([], epoch))));
  const saveSnapshot = vi.fn<RecorderConfig['saveSnapshot']>(async () => {}), appendObservation = vi.fn<RecorderConfig['appendObservation']>(async () => {});
  const recorder = createRecorder({ base: 'https://example.invalid', token: 'secret', fetchImpl,
    now: () => at, saveSnapshot, appendObservation, pollMs: 1 });
  return { recorder, fetchImpl, saveSnapshot, appendObservation, advance: () => { at = new Date(at.getTime() + 30_000); } };
}
describe('recorded poll history', () => {
  it('retains the legacy snapshot naming scheme', () => expect(snapshotName('tripupdates', epoch)).toBe(`${epoch}.tripupdates.pb`));
  it('deduplicates snapshots but records each successful poll, never faster than 30 seconds', async () => {
    const s = setup(); await s.recorder.tick(); await s.recorder.tick();
    expect(s.fetchImpl).toHaveBeenCalledTimes(3); expect(s.saveSnapshot).toHaveBeenCalledTimes(3);
    s.advance(); await s.recorder.tick();
    expect(s.saveSnapshot).toHaveBeenCalledTimes(3); expect(s.appendObservation).toHaveBeenCalledTimes(6);
  });
  it('does not acknowledge or deduplicate a failed disk write; retries the same snapshot', async () => {
    const s = setup(); s.saveSnapshot.mockRejectedValueOnce(new Error('disk full'));
    await s.recorder.tick();
    expect(s.appendObservation.mock.calls[0][0]).toMatchObject({ feed: 'positions', ok: false });
    s.advance(); await s.recorder.tick(); expect(s.saveSnapshot).toHaveBeenCalledTimes(4);
  });
  it('writes the snapshot before recording success', async () => {
    const s = setup(); await s.recorder.tick();
    expect(s.saveSnapshot.mock.invocationCallOrder[0]).toBeLessThan(s.appendObservation.mock.invocationCallOrder[0]);
  });
  it('suppresses raw fetch errors, missing timestamps and corrupt responses into failed polls', async () => {
    const s = setup(); s.fetchImpl.mockRejectedValueOnce(new Error('Authorization: secret'));
    s.fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const noTimestamp = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({ header: { gtfsRealtimeVersion: '2.0' }, entity: [] }).finish();
    s.fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array(noTimestamp)));
    await s.recorder.tick();
    expect(s.appendObservation.mock.calls.map(c => c[0].ok)).toEqual([false, false, false]);
    expect(JSON.stringify(s.appendObservation.mock.calls)).not.toContain('secret');
  });
  it('serializes overlapping timer ticks through their writes', async () => {
    const s = setup(); let release!: () => void;
    s.saveSnapshot.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const first = s.recorder.tick();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    s.advance(); const second = s.recorder.tick();
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]); expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('propagates failed observation writes instead of claiming the poll was recorded', async () => {
    const s = setup(); s.appendObservation.mockRejectedValueOnce(new Error('disk full'));
    await expect(s.recorder.tick()).rejects.toThrow('disk full');
    s.advance(); await s.recorder.tick();
  });
});
it('keeps each feed at least 30 seconds apart even when the preceding tick was slow', async () => {
  const s = setup();
  s.fetchImpl.mockImplementationOnce(async () => { s.advance(); return new Response(new Uint8Array(encodeFeed([], epoch))); });
  await s.recorder.tick(); await s.recorder.tick();
  // Positions was attempted at :00; the other feeds only began at :30.
  expect(s.fetchImpl).toHaveBeenCalledTimes(4);
});
