import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ update: [] as unknown[][], remove: [] as string[], goto: [] as string[] }));

vi.mock('$lib/pb', () => ({
  pb: {
    filter: (raw: string) => raw,
    collection: () => ({
      update: async (...args: unknown[]) => { calls.update.push(args); },
      delete: async (id: string) => { calls.remove.push(id); },
      getFullList: async () => [
        { id: 'a', order: 1, station_id: 'LAGRANGE' },
        { id: 'b', order: 2, station_id: 'LAGRANGE' }
      ]
    })
  }
}));
vi.mock('$app/navigation', () => ({ goto: async (url: string) => { calls.goto.push(url); } }));

const { recordActions } = await import('$lib/planActions');

beforeEach(() => { calls.update = []; calls.remove = []; calls.goto = []; });

describe('recordActions', () => {
  it('writes a layover straight to the record', async () => {
    await recordActions('itinerary000001', () => {}).setDwell('a', 90);
    expect(calls.update[0]).toEqual(['a', { dwell_min: 90 }]);
  });

  it('swaps two stops by renumbering both', async () => {
    await recordActions('itinerary000001', () => {}).move('b', -1);
    expect(calls.update).toEqual([['b', { order: 1 }], ['a', { order: 2 }]]);
  });

  it('refuses to swap two stops at the same station but opposite directions', async () => {
    const pb = await import('$lib/pb');
    vi.spyOn(pb.pb, 'collection').mockReturnValue({
      update: async (...args: unknown[]) => { calls.update.push(args); },
      getFullList: async () => [
        { id: 'a', order: 1, station_id: 'LAGRANGE', direction: 'out' },
        { id: 'b', order: 2, station_id: 'LAGRANGE', direction: 'back' }
      ]
    } as never);
    await recordActions('itinerary000001', () => {}).move('b', -1);
    expect(calls.update).toEqual([]);
    vi.restoreAllMocks();
  });

  it('deletes a stop', async () => {
    await recordActions('itinerary000001', () => {}).remove('a');
    expect(calls.remove).toEqual(['a']);
  });

  it('sends the add screen the station and the side it was tapped on', () => {
    recordActions('it1', () => {}).add('LAGRANGE', 'right');
    expect(calls.goto[0]).toBe('/plan/it1/add?station=LAGRANGE&side=right');
  });

  it('reports a failure through onerror instead of throwing', async () => {
    const pb = await import('$lib/pb');
    vi.spyOn(pb.pb, 'collection').mockReturnValue({ update: async () => { throw new Error('offline'); } } as never);
    const seen: string[] = [];
    await recordActions('itinerary000001', (m) => seen.push(m)).setDwell('a', 30);
    expect(seen).toEqual(['offline']);
    vi.restoreAllMocks();
  });
});
