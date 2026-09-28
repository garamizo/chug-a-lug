import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/labels';

const state = vi.hoisted(() => ({ taken: false, filters: [] as string[] }));
vi.mock('$lib/server/pb', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1' })),
  adminPb: vi.fn(async () => ({
    filter: (raw: string, p: Record<string, string>) => `${raw}|${JSON.stringify(p)}`,
    collection: () => ({ getList: async (_p: number, _n: number, o: { filter: string }) => { state.filters.push(o.filter); return { totalItems: state.taken ? 1 : 0, items: [] }; } })
  }))
}));
const { GET } = await import('../../src/routes/api/plan/title-check/+server');
const call = (q: string) => GET({ request: new Request(`http://x/api/plan/title-check?${q}`), url: new URL(`http://x/api/plan/title-check?${q}`) } as never);

beforeEach(() => { state.taken = false; state.filters = []; });

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
});
