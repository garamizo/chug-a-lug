import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ path: '', body: null as unknown }));
vi.mock('$lib/api', () => ({
  api: async (path: string, init: { json?: unknown }) => {
    sent.path = path; sent.body = init.json;
    return { anchorAt: '2026-12-26T18:00:00.000Z', legs: [{
      fromStopId: 'a', toStopId: 'b', kind: 'train',
      readyAt: '2026-12-26T18:00:00.000Z', departAt: '2026-12-26T18:30:00.000Z', arriveAt: '2026-12-26T18:59:00.000Z',
      segments: [{ kind: 'train', tripId: 'BN4', routeId: 'BNSF', headsign: 'Chicago', from: 'LAGRANGE', to: 'CUS', dep: '2026-12-26T18:30:00.000Z', arr: '2026-12-26T18:55:00.000Z' }]
    }] };
  }
}));

const { previewPlan } = await import('$lib/live/preview');

const plan = {
  anchorStopId: 'a', removed: [],
  stops: [
    { id: 'a', order: 1, name: 'The Hop Haus', kind: 'bar' as const, station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 60, walk_min: 5, direction: 'out' as const },
    { id: 'b', order: 2, name: 'Berwyn Beer Hall', kind: 'bar' as const, station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 4, direction: 'out' as const }
  ]
};

describe('previewPlan', () => {
  it('sends only what the planner needs', async () => {
    await previewPlan(plan, 'itinerary000001');
    expect(sent.path).toBe('/api/plan/preview');
    expect(sent.body).toEqual({
      itinerary: 'itinerary000001', anchorStopId: 'a',
      stops: [
        { id: 'a', order: 1, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
        { id: 'b', order: 2, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
      ]
    });
  });

  it('renames the fields so the itinerary components can render it', async () => {
    const legs = await previewPlan(plan, 'itinerary000001');
    expect(legs[0]).toMatchObject({
      id: 'preview:a:b', itinerary: 'itinerary000001', from_stop: 'a', to_stop: 'b', kind: 'train',
      ready_at: '2026-12-26T18:00:00.000Z', depart_at: '2026-12-26T18:30:00.000Z', arrive_at: '2026-12-26T18:59:00.000Z'
    });
    expect(legs[0].segments[0]).toMatchObject({ kind: 'train', tripId: 'BN4' });
  });
});
