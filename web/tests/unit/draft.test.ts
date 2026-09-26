import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getOne: vi.fn(), getFullList: vi.fn() }));
vi.mock('$lib/pb', () => ({ pb: { collection: () => mocks, filter: (s: string) => s }, subscribe: () => () => {} }));
const { loadDraft, preloadDraft, draftFrom } = await import('../../src/lib/draft');
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  mocks.getOne.mockResolvedValue({ id: 'd1' });
  mocks.getFullList.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

it('loads each stop with its place, so the cards can show its photo', async () => {
  await loadDraft('d1');
  expect(mocks.getFullList).toHaveBeenCalledWith(expect.objectContaining({ sort: 'order,created', expand: 'place' }));
});
it('uses a read the route started while the page was still loading', async () => {
  const early = preloadDraft('d1');
  expect(mocks.getOne).toHaveBeenCalledOnce();
  expect((await draftFrom(early, 'd1')).itinerary.id).toBe('d1');
  expect(mocks.getOne).toHaveBeenCalledOnce();
});
it('reads again when the early read is stale or belongs to another draft', async () => {
  const early = preloadDraft('d1');
  vi.advanceTimersByTime(10_000);
  await draftFrom(early, 'd1');
  expect(mocks.getOne).toHaveBeenCalledTimes(2);
  await draftFrom(preloadDraft('d1'), 'd2');
  expect(mocks.getOne).toHaveBeenLastCalledWith('d2');
});
