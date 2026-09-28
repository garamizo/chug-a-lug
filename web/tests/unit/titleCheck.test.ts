import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/labels';

const state = vi.hoisted(() => ({
  taken: false, filters: [] as string[],
  /** The `route` id's own `title_key`, as the DB holds it right now; undefined if unset. */
  ownKey: undefined as string | undefined,
  /** True to simulate the own-route lookup failing (e.g. a bad or deleted id). */
  ownMissing: false,
  getOneCalls: [] as string[]
}));
vi.mock('$lib/server/pb', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1' })),
  adminPb: vi.fn(async () => ({
    filter: (raw: string, p: Record<string, string>) => `${raw}|${JSON.stringify(p)}`,
    collection: () => ({
      getOne: async (id: string) => {
        state.getOneCalls.push(id);
        if (state.ownMissing) throw Object.assign(new Error('missing'), { status: 404 });
        return { id, title_key: state.ownKey };
      },
      getList: async (_p: number, _n: number, o: { filter: string }) => { state.filters.push(o.filter); return { totalItems: state.taken ? 1 : 0, items: [] }; }
    })
  }))
}));
const { GET } = await import('../../src/routes/api/plan/title-check/+server');
const call = (q: string) => GET({ request: new Request(`http://x/api/plan/title-check?${q}`), url: new URL(`http://x/api/plan/title-check?${q}`) } as never);

beforeEach(() => { state.taken = false; state.filters = []; state.ownKey = undefined; state.ownMissing = false; state.getOneCalls = []; });

describe('GET /api/plan/title-check', () => {
  it('accepts a free name and looks it up by key, excluding the route itself', async () => {
    const res = await call('title=%20Loop%20%20Crawl&route=itinerary000001');
    expect(await res.json()).toEqual({ ok: true });
    expect(state.filters[0]).toContain('"k":"loop crawl"');
    expect(state.filters[0]).toContain('"id":"itinerary000001"');
  });
  it('refuses a taken or invalid name with copy', async () => {
    state.taken = true;
    await expect(call('title=Loop')).rejects.toMatchObject({ status: 400, body: { message: copy.titleTaken } });
    await expect(call('title=')).rejects.toMatchObject({ status: 400, body: { message: copy.titleInvalid } });
  });
  it('skips the own-key lookup when there is no route id (create)', async () => {
    const res = await call('title=Brand%20New');
    expect(await res.json()).toEqual({ ok: true });
    expect(state.getOneCalls).toEqual([]);
  });
  it('lets a route keep its own key even when a legacy duplicate holds it too, without checking other routes', async () => {
    // The migration deliberately preserves legacy duplicate names, and the update hook's
    // `nameChanged` test lets a route re-case its own unchanged key freely. `taken` simulates
    // another route matching the same key; the route's own unchanged key must still win.
    state.taken = true;
    state.ownKey = 'loop crawl';
    const res = await call('title=Loop%20CRAWL&route=itinerary000001');
    expect(await res.json()).toEqual({ ok: true });
    expect(state.filters).toEqual([]);
  });
  it('still rejects a name genuinely taken by another route', async () => {
    state.taken = true;
    state.ownKey = 'some other key';
    await expect(call('title=Loop%20Crawl&route=itinerary000001')).rejects.toMatchObject({ status: 400, body: { message: copy.titleTaken } });
  });
  it('treats an unreadable route id as having no key of its own', async () => {
    state.ownMissing = true;
    const res = await call('title=Loop%20Crawl&route=itinerary000001');
    expect(await res.json()).toEqual({ ok: true });
  });
});
