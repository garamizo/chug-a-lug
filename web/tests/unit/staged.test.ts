import { describe, expect, it } from 'vitest';
import { addStop, commitPayload, moveStop, newRecordId, removeStop, setAnchor, setDwell, stagePlan } from '../../src/lib/live/staged';
import type { Stop } from '../../src/lib/types';

const record = (id: string, order: number, name: string, station = 'LAGRANGE'): Stop => ({
  id, order, name, station_id: station, station_name: station === 'CUS' ? 'Union Station' : 'La Grange Road',
  dwell_min: 60, walk_min: 5, kind: 'bar', direction: 'out'
} as Stop);

const venue = { name: 'Prairie Path Tap', kind: 'bar' as const, station_id: 'CUS', station_name: 'Union Station', dwell_min: 45, walk_min: 6, direction: 'out' as const };
const base = () => stagePlan([record('a', 1, 'The Hop Haus'), record('b', 2, 'The Second Round'), record('c', 3, 'Berwyn Beer Hall', 'CUS')], 'a');

describe('newRecordId', () => {
  it('looks like a PocketBase id and does not repeat', () => {
    const id = newRecordId();
    expect(id).toMatch(/^[a-z0-9]{15}$/);
    expect(new Set(Array.from({ length: 50 }, newRecordId)).size).toBe(50);
  });
});

describe('stagePlan', () => {
  it('copies the records into a staged plan with nothing removed', () => {
    const plan = base();
    expect(plan.stops.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(plan.stops.every((s) => !s.isNew)).toBe(true);
    expect(plan).toMatchObject({ anchorStopId: 'a', removed: [] });
  });
  it('does not alias the records it was given', () => {
    const stops = [record('a', 1, 'The Hop Haus')];
    const plan = setDwell(stagePlan(stops, 'a'), 'a', 120);
    expect(plan.stops[0].dwell_min).toBe(120);
    expect(stops[0].dwell_min).toBe(60);
  });
});

describe('editing', () => {
  it('sets a layover', () => {
    expect(setDwell(base(), 'b', 90).stops[1].dwell_min).toBe(90);
  });

  it('swaps two stops at the same station and renumbers', () => {
    const plan = moveStop(base(), 'b', -1);
    expect(plan.stops.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(plan.stops.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('refuses a swap across stations, as the line map does', () => {
    expect(moveStop(base(), 'c', -1).stops.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('refuses a swap at the same station but opposite directions', () => {
    const plan = stagePlan([
      record('a', 1, 'The Hop Haus'),
      { ...record('b', 2, 'The Second Round'), direction: 'back' } as Stop
    ], 'a');
    expect(moveStop(plan, 'b', -1).stops.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('removes a stop, remembers its id and renumbers', () => {
    const plan = removeStop(base(), 'b');
    expect(plan.stops.map((s) => s.id)).toEqual(['a', 'c']);
    expect(plan.stops.map((s) => s.order)).toEqual([1, 2]);
    expect(plan.removed).toEqual(['b']);
  });

  it('keeps the anchor pointing at a removed stop so the gate can complain', () => {
    expect(removeStop(base(), 'a').anchorStopId).toBe('a');
  });

  it('forgets a staged stop instead of queueing a delete for a record that never existed', () => {
    const added = addStop(base(), venue, 3);
    const gone = removeStop(added, added.stops[3].id);
    expect(gone.removed).toEqual([]);
    expect(gone.stops).toHaveLength(3);
  });

  it('inserts a new stop with a real id, flagged as new', () => {
    const plan = addStop(base(), venue, 1);
    expect(plan.stops.map((s) => s.name)).toEqual(['The Hop Haus', 'Prairie Path Tap', 'The Second Round', 'Berwyn Beer Hall']);
    expect(plan.stops[1].id).toMatch(/^[a-z0-9]{15}$/);
    expect(plan.stops[1].isNew).toBe(true);
    expect(plan.stops.map((s) => s.order)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a new stop’s id stable across later edits, so a retried save cannot duplicate it', () => {
    const added = addStop(base(), venue, 3);
    const id = added.stops[3].id;
    const edited = setDwell(moveStop(added, id, -1), id, 30);
    expect(edited.stops.find((s) => s.name === 'Prairie Path Tap')!.id).toBe(id);
  });

  it('gives every new stop its own id', () => {
    const one = addStop(base(), venue, 3);
    const two = addStop(one, { ...venue, name: 'Another Bar' }, 4);
    expect(two.stops[3].id).not.toBe(two.stops[4].id);
  });

  it('moves the crew', () => {
    expect(setAnchor(base(), 'c').anchorStopId).toBe('c');
  });
});

describe('commitPayload', () => {
  it('carries the itinerary, the anchor, the stops and the deletions', () => {
    const plan = removeStop(setAnchor(base(), 'b'), 'c');
    expect(commitPayload(plan, 'itinerary000001')).toEqual({
      itinerary: 'itinerary000001', anchorStopId: 'b', removed: ['c'], stops: plan.stops
    });
  });
});
