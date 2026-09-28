import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/pb', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
const venueMedia = vi.hoisted(() => vi.fn(async () => ({ status: 'done' })));
vi.mock('$lib/server/places/attach', () => ({ venueMedia }));
const { POST } = await import('../../src/routes/api/places/photos/+server');

const post = (body: string) => POST({
  request: new Request('http://x/api/places/photos', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
} as never);

describe('POST /api/places/photos', () => {
  it('answers 400, not 500, to a JSON body of null', async () => {
    await expect(post('null')).rejects.toMatchObject({ status: 400 });
    expect(venueMedia).not.toHaveBeenCalled();
  });
  it('answers 400 to a body that is not JSON', async () => {
    await expect(post('nope')).rejects.toMatchObject({ status: 400 });
  });
  it('fetches the photos for a well-formed placeRef', async () => {
    const res = await post(JSON.stringify({ placeRef: 'place0000000001' }));
    expect(res.status).toBe(200);
    expect(venueMedia).toHaveBeenCalledWith('place0000000001');
  });
});
