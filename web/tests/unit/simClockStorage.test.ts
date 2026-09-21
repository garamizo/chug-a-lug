import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ env: { SIM: '1', SIM_RUN_ID: 'storage-run' } as Record<string, string>, getOne: vi.fn(), update: vi.fn(), adminPb: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$lib/server/pb', () => ({ adminPb: mocks.adminPb }));
const { simulationClock } = await import('$lib/server/sim/clock');
const row = {
  run_id: 'storage-run', revision: 1, epoch_start: '2026-12-26 18:00:00.000Z',
  wall_start: '2026-09-21 12:00:00.000Z', rate: 0, resume_rate: 1,
  service_date: '2026-12-26', source: 'timetable', recording_id: '',
  window_start: '2026-12-26 06:00:00.000Z', window_end: '2026-12-27 04:00:00.000Z'
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.env.SIM = '1';
  mocks.getOne.mockResolvedValue(row);
  mocks.update.mockResolvedValue({});
  mocks.adminPb.mockResolvedValue({ collection: (name: string) => {
    expect(name).toBe('simulation_clock');
    return { getOne: mocks.getOne, update: mocks.update };
  } });
});
it('converts PocketBase date strings and nullable recording ID to the public contract', async () => {
  expect(await simulationClock.readContext()).toMatchObject({ enabled: true, eventNow: '2026-12-26T18:00:00.000Z', recordingId: null });
  expect(mocks.getOne).toHaveBeenCalledWith('simulationclock');
});
it('writes only the mutable clock fields to the existing singleton', async () => {
  await simulationClock.change(1, { action: 'rate', rate: 5 });
  expect(mocks.update).toHaveBeenCalledWith('simulationclock', {
    revision: 2, epoch_start: '2026-12-26T18:00:00.000Z', wall_start: expect.any(String), rate: 0, resume_rate: 5
  });
});
it.each(['', '0', 'true'])('SIM=%s is disabled without database access', async (value) => {
  mocks.env.SIM = value;
  expect(await simulationClock.readContext()).toMatchObject({ enabled: false });
  expect(mocks.adminPb).not.toHaveBeenCalled();
});
