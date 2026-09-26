import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getOne: vi.fn(), getFullList: vi.fn(), update: vi.fn() }));
vi.mock('$lib/pb', () => ({ pb: { collection: () => mocks, filter: (s: string) => s } }));
const { resolveCurrentRoute } = await import('../../src/lib/live/route');
beforeEach(() => vi.clearAllMocks());

it('uses the selected route when it is locked', async () => {
  mocks.getOne.mockImplementation(async (id: string) => id === 'crawlsettings'
    ? { current_itinerary: 'r1', expand: { current_itinerary: { id: 'r1', status: 'locked' } } } : null);
  mocks.getFullList.mockResolvedValue([{ id: 'r9', status: 'locked' }]);
  expect((await resolveCurrentRoute())?.id).toBe('r1');
});
it('asks for the selection and the fallback at once, so a missing selection costs no extra round trip', async () => {
  let release!: () => void;
  mocks.getOne.mockReturnValue(new Promise((r) => (release = () => r({ current_itinerary: '' }))));
  mocks.getFullList.mockResolvedValue([{ id: 'r9', status: 'locked' }]);
  const answer = resolveCurrentRoute();
  await Promise.resolve();
  expect(mocks.getFullList).toHaveBeenCalled();
  release();
  expect((await answer)?.id).toBe('r9');
});
it('falls back to the newest locked route when nothing is selected or the selection is stale', async () => {
  mocks.getFullList.mockResolvedValue([{ id: 'r9', status: 'locked' }]);
  mocks.getOne.mockResolvedValue({ current_itinerary: 'r1', expand: { current_itinerary: { id: 'r1', status: 'archived' } } });
  expect((await resolveCurrentRoute())?.id).toBe('r9');
  mocks.getOne.mockResolvedValue({ current_itinerary: '' });
  expect((await resolveCurrentRoute())?.id).toBe('r9');
});
it('has no route when nothing is locked', async () => {
  mocks.getOne.mockRejectedValue(new Error('404'));
  mocks.getFullList.mockResolvedValue([]);
  expect(await resolveCurrentRoute()).toBeNull();
});
it('lets a network failure propagate so liveDay can fall back to its mirror', async () => {
  mocks.getOne.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
  mocks.getFullList.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
  await expect(resolveCurrentRoute()).rejects.toThrow('offline');
});
