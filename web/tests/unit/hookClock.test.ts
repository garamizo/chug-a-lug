import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import vectors from '../fixtures/sim/clock-vectors.json';
const base = { run_id: 'test', revision: 1, epoch_start: '2026-12-26T18:00:00.000Z',
  wall_start: '2026-09-21T12:00:00.000Z', rate: 0, resume_rate: 1, service_date: '2026-12-26',
  source: 'timetable', recording_id: '', window_start: '2026-12-26T06:00:00.000Z', window_end: '2026-12-27T04:00:00.000Z' };
function helper(enabled = true, patch = {}) {
  const read = vi.fn(() => ({ get: (key: string) => ({ ...base, ...patch } as Record<string, unknown>)[key] }));
  const module = { exports: {} as { eventNow: (app: unknown, now?: Date) => string } };
  runInNewContext(readFileSync('../pocketbase/pb_hooks/clock.js', 'utf8'), { module, Date, $os: { getenv: (key: string) => key === 'SIM' ? (enabled ? '1' : '0') : 'test' } });
  return { read, now: (wall: string) => module.exports.eventNow({ findRecordById: read }, new Date(wall)) };
}
it.each(vectors)('PocketBase clock matches $name', v => {
  const patch = Object.fromEntries(Object.entries(v.state).map(([k, value]) => [k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), value]));
  expect(helper(true, patch).now(v.wallNow)).toBe(v.eventNow);
});
it('does not read clock storage in normal mode', () => {
  const h = helper(false);
  expect(h.now('2026-09-21T12:00:00Z')).toBe('2026-09-21T12:00:00.000Z');
  expect(h.read).not.toHaveBeenCalled();
});
it.each([{ rate: 2 }, { revision: 0 }, { epoch_start: 'broken' }, { run_id: 'other' }])('rejects invalid clock %j', patch => {
  expect(() => helper(true, patch).now('2026-09-21T12:00:00Z')).toThrow();
});
