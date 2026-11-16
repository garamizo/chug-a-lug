import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ids: ['aaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbb', 'ccccccccccccccc'], failing: new Set<string>(), order: [] as string[] }));
vi.mock('$lib/server/pb', () => ({
  requireInternal: (request: Request) => {
    if (request.headers.get('x-internal-secret') !== 'secret') throw Object.assign(new Error('Bad internal secret.'), { status: 401 });
  },
  adminPb: vi.fn(async () => ({ collection: () => ({ getFullList: async () => state.ids.map((id) => ({ id })) }) }))
}));
vi.mock('$lib/server/recompute', () => ({
  recomputeItinerary: vi.fn(async (id: string) => {
    state.order.push(id);
    if (state.failing.has(id)) throw new Error(`boom ${id}`);
    return { legs: 0, impossible: 0, impossibleFromAnchor: 0 };
  })
}));
const { POST } = await import('../../src/routes/api/internal/recompute/+server');

const call = (query: string, secret: string | null = 'secret') =>
  POST({ request: new Request(`http://x/api/internal/recompute?${query}`, { method: 'POST', headers: secret ? { 'x-internal-secret': secret } : {} }),
    url: new URL(`http://x/api/internal/recompute?${query}`) } as never);

beforeEach(() => { state.failing.clear(); state.order = []; });

describe('POST /api/internal/recompute?all=1', () => {
  it('replans every itinerary in turn and lists them', async () => {
    const res = await call('all=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: state.ids, failed: [] });
    expect(state.order).toEqual(state.ids);
  });
  it('answers 500 with the failed id and carries on with the rest', async () => {
    state.failing.add('bbbbbbbbbbbbbbb');
    const res = await call('all=1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: ['aaaaaaaaaaaaaaa', 'ccccccccccccccc'], failed: [{ id: 'bbbbbbbbbbbbbbb', error: 'boom bbbbbbbbbbbbbbb' }] });
  });
  it('refuses without the secret', async () => {
    await expect(call('all=1', null)).rejects.toMatchObject({ status: 401 });
    expect(state.order).toEqual([]);
  });
  it('still queues a single itinerary and answers 202', async () => {
    const res = await call('itinerary=aaaaaaaaaaaaaaa');
    expect(res.status).toBe(202);
  });
});
