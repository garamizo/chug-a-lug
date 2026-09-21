import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSchedule } from '../fixtures/loadFixture';
import { copy } from '../../src/lib/labels';

const state = vi.hoisted(() => ({
  user: { id: 'u1', is_admin: true },
  itinerary: { id: 'itinerary000001', status: 'locked', event_date: '2026-12-26', start_time: '11:00' } as Record<string, unknown>,
  /** What the database holds for this itinerary right now. */
  persisted: ['s2', 's3'] as string[],
  writes: [] as { op: string; collection: string; id?: string; body?: Record<string, unknown> }[],
  /** `${op}:${collection}:${id}` -> the error to throw once, so a retry can be simulated. */
  fail: {} as Record<string, { status: number; message: string }>,
  /** Ids `getOne` will find and report as belonging to *this* itinerary. */
  found: ['s2', 's3'] as string[],
  /** Ids `getOne` will find, but report as belonging to some other itinerary entirely. */
  foreign: [] as string[]
}));

vi.mock('$lib/server/pb', () => ({
  requireUser: vi.fn(async () => state.user),
  adminPb: vi.fn(async () => ({
    filter: (raw: string) => raw,
    collection: (collection: string) => ({
      getOne: async (id: string) => {
        if (collection === 'itineraries') return state.itinerary;
        if (state.foreign.includes(id)) return { id, itinerary: 'zzzforeignitin0' };
        if (state.found.includes(id)) return { id, itinerary: state.itinerary.id as string };
        throw Object.assign(new Error('not found'), { status: 404 });
      },
      getFullList: async () => (collection === 'stops' ? state.persisted.map((id) => ({ id })) : []),
      create: async (body: Record<string, unknown>) => {
        const key = `create:${collection}:${body.id ?? ''}`;
        if (state.fail[key]) throw Object.assign(new Error(state.fail[key].message), { status: state.fail[key].status });
        state.writes.push({ op: 'create', collection, body });
        return { id: (body.id as string) ?? `${collection}1`, ...body };
      },
      update: async (id: string, body: Record<string, unknown>) => {
        state.writes.push({ op: 'update', collection, id, body });
        return { id };
      },
      delete: async (id: string) => {
        const key = `delete:${collection}:${id}`;
        if (state.fail[key]) throw Object.assign(new Error(state.fail[key].message), { status: state.fail[key].status });
        state.writes.push({ op: 'delete', collection, id });
      }
    })
  }))
}));
vi.mock('$lib/server/metra', () => ({ metra: { getSchedule: vi.fn(async () => fixtureSchedule()) } }));
vi.mock('$lib/server/recompute', () => ({ recomputeItinerary: vi.fn(async () => ({ legs: 1, impossible: 0, impossibleFromAnchor: 0 })) }));

const { POST } = await import('../../src/routes/api/plan/commit/+server');
const { recomputeItinerary } = await import('$lib/server/recompute');

// A real PocketBase id is 15 lowercase alphanumerics, and the endpoint validates that shape — so
// the fixtures use a real-shaped id rather than a friendly stub.
const call = (body: unknown) =>
  POST({ request: new Request('http://x/api/plan/commit', { method: 'POST', body: JSON.stringify(body) }) } as never);

// 12:00 local on the crawl day: an anchor at La Grange still catches BN4 at 14:30.
const rideable = {
  itinerary: 'itinerary000001', anchorStopId: 's2', removed: [] as string[],
  stops: [
    { id: 's2', order: 1, name: 'The Hop Haus', kind: 'bar', station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 60, walk_min: 5 },
    { id: 's3', order: 2, name: 'Berwyn Beer Hall', kind: 'bar', station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 4 }
  ]
};
const newStop = { id: 'abcdefghij01234', isNew: true, order: 3, name: 'Prairie Path Tap', kind: 'bar', station_id: 'CUS', station_name: 'Union Station', dwell_min: 45, walk_min: 6 };

beforeEach(() => {
  state.user = { id: 'u1', is_admin: true };
  state.itinerary = { id: 'itinerary000001', status: 'locked', event_date: '2026-12-26', start_time: '11:00' };
  state.persisted = ['s2', 's3'];
  state.found = ['s2', 's3'];
  state.foreign = [];
  state.writes = [];
  state.fail = {};
  vi.mocked(recomputeItinerary).mockClear().mockResolvedValue({ legs: 1, impossible: 0, impossibleFromAnchor: 0 });
  vi.setSystemTime(new Date('2026-12-26T18:00:00.000Z'));
});

describe('POST /api/plan/commit', () => {
  it('refuses anyone who is not the Conductor', async () => {
    state.user = { id: 'u2', is_admin: false };
    await expect(call(rideable)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to edit an itinerary that is not locked', async () => {
    state.itinerary = { id: 'itinerary000001', status: 'draft', event_date: '2026-12-26', start_time: '11:00' };
    await expect(call(rideable)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a plan that cannot be ridden, and writes nothing', async () => {
    vi.setSystemTime(new Date('2026-12-26T21:00:00.000Z')); // 15:00 local: BN4 has gone
    const res = await call(rideable);
    expect(res.status).toBe(409);
    expect((await res.json()).blockers[0].code).toBe('impossible_leg');
    expect(state.writes).toEqual([]);
  });

  it('rejects impossible legs before the selected position off the event day without writing', async () => {
    vi.setSystemTime(new Date('2026-12-19T18:00:00.000Z'));
    const res = await call({
      ...rideable, anchorStopId: 's3',
      stops: [{ ...rideable.stops[0], dwell_min: 600 }, rideable.stops[1]]
    });
    expect(res.status).toBe(409);
    expect((await res.json()).blockers[0].code).toBe('impossible_leg');
    expect(state.writes).toEqual([]);
    expect(recomputeItinerary).not.toHaveBeenCalled();
  });

  it('still treats legs before the selected position as history on the event day', async () => {
    const res = await call({
      ...rideable, anchorStopId: 's3',
      stops: [{ ...rideable.stops[0], dwell_min: 600 }, rideable.stops[1]]
    });
    expect(res.status).toBe(200);
  });

  it('refuses when the route holds a stop the editor never saw', async () => {
    state.persisted = ['s2', 's3', 'sOther']; // someone added a stop while this editor was open
    const res = await call(rideable);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, stale: true, message: copy.routeMovedOn });
    expect(state.writes).toEqual([]);
  });

  it('refuses when a kept stop was deleted by another Conductor', async () => {
    // The symmetric twin of "refuses when the route holds a stop the editor never saw": here the
    // payload is stale in the other direction — it still keeps a stop (s3) the database no longer
    // has, with nothing in `removed` to explain the gap. Without this check, s3 falls into the
    // create branch and comes back resurrected with none of its venue fields.
    state.persisted = ['s2'];
    const res = await call(rideable); // keeps s2 and s3, removes nothing
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toBe(true);
    expect(state.writes).toEqual([]);
  });

  it('ignores a removed id that belongs to no persisted stop of this route', async () => {
    // Whether it never existed, belongs to another itinerary, or a previous attempt already deleted
    // it, an unpersisted `removed` id is already the state we wanted: the commit converges without
    // issuing a delete for it and without refusing as stale.
    const res = await call({ ...rideable, removed: ['sFromAnotherItinerary'] });
    expect(res.status).toBe(200);
    expect(state.writes.some((w) => w.op === 'delete')).toBe(false);
  });

  it('applies the stops, then anchors the crawl, then recomputes', async () => {
    state.persisted = ['s2', 's3', 'sX'];
    const res = await call({ ...rideable, removed: ['sX'], stops: [...rideable.stops, newStop] });
    expect(res.status).toBe(200);

    const order = state.writes.map((w) => `${w.op}:${w.collection}`);
    expect(order.slice(0, 2)).toEqual(['delete:stops', 'update:stops']);
    expect(order.indexOf('create:checkins')).toBeGreaterThan(order.lastIndexOf('create:stops'));
    expect(order[order.length - 1]).toBe('create:event_log');
    expect(recomputeItinerary).toHaveBeenCalledWith('itinerary000001');

    // The new stop is written under the id the editor generated, not one PocketBase invents.
    expect(state.writes.find((w) => w.op === 'create' && w.collection === 'stops')!.body)
      .toMatchObject({ id: 'abcdefghij01234', itinerary: 'itinerary000001', name: 'Prairie Path Tap' });
    expect(state.writes.find((w) => w.collection === 'checkins')!.body)
      .toMatchObject({ user: 'u1', stop: 's2', kind: 'at_stop', at: '2026-12-26T18:00:00.000Z' });
  });

  it('anchors on a stop this very commit created', async () => {
    const res = await call({ ...rideable, anchorStopId: newStop.id, stops: [...rideable.stops, newStop] });
    expect(res.status).toBe(200);
    expect(state.writes.find((w) => w.collection === 'checkins')!.body).toMatchObject({ stop: newStop.id });
  });

  it('survives a retry after the delete already went through', async () => {
    // This is the real retry state: the previous attempt's delete succeeded, so `sX` is already gone
    // from the database by the time this request's reconcile step reads `persisted`. A payload that
    // still asks to remove it must converge, not refuse — and must not attempt the delete again.
    state.persisted = ['s2', 's3'];
    const res = await call({ ...rideable, removed: ['sX'] });
    expect(res.status).toBe(200);
    expect(state.writes.some((w) => w.op === 'delete' && w.id === 'sX')).toBe(false);
  });

  it('survives a retry after the new stop was already created', async () => {
    // The previous attempt got far enough to create the stop: it is in the database now, so a
    // retry of the identical payload must find it there, not refuse as stale.
    state.persisted = ['s2', 's3', newStop.id];
    state.fail[`create:stops:${newStop.id}`] = { status: 400, message: 'Failed to create record.' };
    state.found = ['s2', 's3', newStop.id]; // the previous attempt got that far
    const res = await call({ ...rideable, stops: [...rideable.stops, newStop] });
    expect(res.status).toBe(200);
    // No second record: the collision is resolved by bringing the existing one in line.
    expect(state.writes.filter((w) => w.op === 'create' && w.collection === 'stops')).toHaveLength(0);
    expect(state.writes.some((w) => w.op === 'update' && w.id === newStop.id)).toBe(true);
  });

  it('gives up when the create failed for a reason other than already existing', async () => {
    state.fail[`create:stops:${newStop.id}`] = { status: 500, message: 'PocketBase is down' };
    await expect(call({ ...rideable, stops: [...rideable.stops, newStop] })).rejects.toThrow();
  });

  it('refuses to adopt a stop id that collides with another itinerary\'s record', async () => {
    // The id is a 15-character random string, so a real collision with someone else's crawl would
    // be astronomically unlikely — but the admin client can see every itinerary, so the check has
    // to be there regardless. This must never resolve as "my previous attempt got this far".
    state.fail[`create:stops:${newStop.id}`] = { status: 400, message: 'Failed to create record.' };
    state.foreign = [newStop.id];
    await expect(call({ ...rideable, stops: [...rideable.stops, newStop] })).rejects.toThrow();
    expect(state.writes.some((w) => w.op === 'update' && w.id === newStop.id)).toBe(false);
  });

  it('refuses a payload that both keeps and removes the same stop', async () => {
    const res = await call({ ...rideable, removed: ['s3'] }); // s3 also appears in stops
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toBe(true);
    expect(state.writes).toEqual([]);
  });

  it('refuses a payload with a stop id repeated inside stops', async () => {
    const res = await call({ ...rideable, stops: [...rideable.stops, { ...rideable.stops[0] }] });
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toBe(true);
    expect(state.writes).toEqual([]);
  });

  it('posts the Bulletin under the id the editor gave it, once', async () => {
    const bulletin = { id: 'bulletin0000001', kind: 'hold' as const, body: 'Holding at The Hop Haus.' };
    const res = await call({ ...rideable, bulletin });
    expect((await res.json()).broadcast).toBe('bulletin0000001');

    state.writes = [];
    state.fail['create:broadcasts:bulletin0000001'] = { status: 400, message: 'Failed to create record.' };
    state.found = ['s2', 's3', 'bulletin0000001'];
    const again = await call({ ...rideable, bulletin });
    expect((await again.json()).broadcast).toBe('bulletin0000001');
    expect(state.writes.some((w) => w.collection === 'broadcasts')).toBe(false); // not said twice
  });

  it('refuses to adopt a broadcast id that collides with another itinerary\'s record', async () => {
    const bulletin = { id: 'bulletin0000001', kind: 'hold' as const, body: 'Holding at The Hop Haus.' };
    state.fail[`create:broadcasts:${bulletin.id}`] = { status: 400, message: 'Failed to create record.' };
    state.foreign = [bulletin.id];
    await expect(call({ ...rideable, bulletin })).rejects.toThrow();
  });

  it('skips the Bulletin when the Conductor skipped it', async () => {
    const res = await call(rideable);
    expect((await res.json()).broadcast).toBeNull();
    expect(state.writes.some((w) => w.collection === 'broadcasts')).toBe(false);
  });

  it('reports the anchor-filtered count, not the raw total, when the recompute finds a leg it could not ride', async () => {
    // Deliberately different: a leg behind the crew (counted in the total) must not be what the
    // response's `impossible` reports, or the Conductor is told to fix a train that already left.
    vi.mocked(recomputeItinerary).mockResolvedValue({ legs: 2, impossible: 2, impossibleFromAnchor: 1 });
    const res = await call(rideable);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, impossible: 1 });
  });

  it('writes the checkins row at the same instant the response reports as the anchor', async () => {
    const res = await call(rideable);
    const body = await res.json();
    const checkin = state.writes.find((w) => w.collection === 'checkins')!;
    expect(checkin.body).toMatchObject({ at: body.anchorAt });
  });

  it('carries direction on an update, but never re-points an existing stop at a new venue', async () => {
    const res = await call({
      ...rideable,
      stops: [{ ...rideable.stops[0], direction: 'inbound' }, rideable.stops[1]]
    });
    expect(res.status).toBe(200);
    const update = state.writes.find((w) => w.op === 'update' && w.id === 's2')!;
    expect(update.body).toMatchObject({ direction: 'inbound' });
    expect(update.body).not.toHaveProperty('place');
  });

  it('leaves direction alone on an update whose payload does not mention it', async () => {
    // rideable.stops[0] carries no `direction` key at all — the editor is echoing back a stop it
    // didn't touch that field on. The update must not overwrite whatever the database already has.
    const res = await call(rideable);
    expect(res.status).toBe(200);
    const update = state.writes.find((w) => w.op === 'update' && w.id === 's2')!;
    expect(update.body).not.toHaveProperty('direction');
  });

  it('refuses a stop with no name or an unrecognised kind, before any write', async () => {
    await expect(call({ ...rideable, stops: [{ ...rideable.stops[0], name: '' }, rideable.stops[1]] }))
      .rejects.toMatchObject({ status: 400 });
    expect(state.writes).toEqual([]);

    await expect(call({ ...rideable, stops: [{ ...rideable.stops[0], kind: 'nightclub' }, rideable.stops[1]] }))
      .rejects.toMatchObject({ status: 400 });
    expect(state.writes).toEqual([]);
  });
});
