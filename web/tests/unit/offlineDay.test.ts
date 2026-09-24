import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary, Leg, Stop } from '../../src/lib/types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), save: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock('$lib/pb', () => ({
  pb: { collection: (name: string) => ({ getFullList: (options: unknown) => mocks.list(name, options) }), filter: (s: string) => s },
  subscribe: mocks.subscribe
}));
vi.mock('$lib/offline', async (original) => ({
  ...await original<typeof import('../../src/lib/offline')>(), readMirror: mocks.read, saveMirror: mocks.save
}));
const { LiveDay } = await import('../../src/lib/live/day.svelte');

const itinerary = { id: 'route', status: 'locked', event_date: '2026-12-26', start_time: '12:00' } as Itinerary;
const stops = [{ id: 'a', itinerary: 'route', order: 1 }] as Stop[];
const legs = [{ id: 'l', itinerary: 'route', from_stop: 'a', to_stop: 'b' }] as Leg[];
const mirror = { itinerary, stops, legs, savedAt: '2026-12-26T20:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockImplementation(async (name: string) => ({ itineraries: [itinerary], stops, legs })[name]);
  mocks.read.mockResolvedValue(mirror);
  mocks.save.mockResolvedValue(undefined);
});

describe('live route mirror', () => {
  it('saves a complete, cloneable network route and bypasses stale response caches', async () => {
    const day = new LiveDay();
    await day.loadRoute();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(structuredClone(mocks.save.mock.calls[0][0])).toMatchObject({ itinerary, stops, legs });
    // The route reads only; a new route also reloads that route's activity, which is not the mirror.
    const routeReads = mocks.list.mock.calls.filter(([name]) => ['itineraries', 'stops', 'legs'].includes(name));
    expect(routeReads).toHaveLength(3);
    for (const [, options] of routeReads) expect(options).toMatchObject({ cache: 'no-store' });
    expect(day.fromMirror).toBe(false);
    expect(day.mirrorSavedAt).toBeNull();
  });

  it.each(['itineraries', 'stops', 'legs'])('restores the entire mirror when %s fails without saving a partial route', async (failed) => {
    mocks.list.mockImplementation(async (name: string) => {
      if (name === failed) throw new Error('no connection');
      return ({ itineraries: [{ ...itinerary, id: 'new-route' }], stops: [], legs: [] })[name];
    });
    const day = new LiveDay();
    await day.loadRoute();
    expect(day.itinerary).toEqual(itinerary);
    expect(day.stops).toEqual(stops);
    expect(day.legs).toEqual(legs);
    expect(day.fromMirror).toBe(true);
    expect(day.mirrorSavedAt).toBe(mirror.savedAt);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('clears the stale notice when the network returns', async () => {
    const day = new LiveDay();
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    await day.loadRoute();
    expect(day.fromMirror).toBe(true);
    await day.loadRoute();
    expect(day.fromMirror).toBe(false);
    expect(day.mirrorSavedAt).toBeNull();
  });

  it('clears the notice and old route when the server has no locked route', async () => {
    const day = new LiveDay();
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    await day.loadRoute();
    mocks.list.mockResolvedValue([]);
    await day.loadRoute();
    expect(day.itinerary).toBeNull();
    expect(day.stops).toEqual([]);
    expect(day.legs).toEqual([]);
    expect(day.fromMirror).toBe(false);
    expect(day.mirrorSavedAt).toBeNull();
  });

  it('leaves the empty state when neither the network nor the mirror is available', async () => {
    const day = new LiveDay();
    mocks.list.mockRejectedValue(new Error('offline'));
    mocks.read.mockResolvedValue(null);
    await expect(day.loadRoute()).rejects.toThrow('offline and no mirror');
    expect(day.itinerary).toBeNull();
    expect(day.fromMirror).toBe(false);
  });
});

it('rejects a mirror belonging to a different rehearsal run', async () => {
  const { clientClock } = await import('$lib/sim/clock.svelte');
  clientClock.enabled = true;
  vi.spyOn(clientClock, 'runId', 'get').mockReturnValue('new-run');
  mocks.list.mockRejectedValue(new Error('offline'));
  mocks.read.mockResolvedValue({ ...mirror, runId: 'old-run' });
  try { await expect(new LiveDay().loadRoute()).rejects.toThrow('offline and no mirror'); }
  finally { clientClock.enabled = false; vi.restoreAllMocks(); }
});
