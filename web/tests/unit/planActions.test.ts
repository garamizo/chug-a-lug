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

  it('writes the Board at station and its name to the itinerary', async () => {
    await recordActions('it1', () => {}).setStartStation?.({ id: 'AURORA', name: 'Aurora' });
    expect(calls.update[0]).toEqual(['it1', { start_station: 'AURORA', start_station_name: 'Aurora' }]);
  });

  it('clears the Board at station', async () => {
    await recordActions('it1', () => {}).setStartStation?.(null);
    expect(calls.update[0]).toEqual(['it1', { start_station: '', start_station_name: '' }]);
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

describe('rename', () => {
  it('writes the title', async () => {
    await recordActions('itinerary000001', () => {}).rename!('New name');
    expect(calls.update.at(-1)).toEqual(['itinerary000001', { title: 'New name' }]);
  });
  it('rejects with copy when the name is taken', async () => {
    const pb = await import('$lib/pb');
    vi.spyOn(pb.pb, 'collection').mockReturnValue({
      update: async () => { throw Object.assign(new Error('Title_taken.'), { response: { message: 'Title_taken.' } }); }
    } as never);
    const { copy } = await import('$lib/labels');
    await expect(recordActions('itinerary000001', () => {}).rename!('Taken')).rejects.toThrow(copy.titleTaken);
    vi.restoreAllMocks();
  });
});
