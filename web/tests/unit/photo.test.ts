import { expect, it, vi } from 'vitest';
vi.mock('$lib/pb', () => ({ pb: { files: { getURL: (r: { id: string }, f: string, o: { thumb: string }) => `/files/${r.id}/${f}?thumb=${o.thumb}` } } }));
const { stopPhoto, stopPhotos } = await import('../../src/lib/photo');

it('uses the place’s first photo as a small thumbnail', () => {
  expect(stopPhoto({ expand: { place: { id: 'p1', photos: ['a.jpg', 'b.jpg'] } } } as never)).toBe('/files/p1/a.jpg?thumb=400x300');
});
it('has no photo when the stop has no place or the place has none yet', () => {
  expect(stopPhoto({} as never)).toBeNull();
  expect(stopPhoto({ expand: { place: { id: 'p1', photos: [] } } } as never)).toBeNull();
});
it('maps saved stops by id, so a staged copy of the same stop keeps its photo', () => {
  expect(stopPhotos([{ id: 's1', expand: { place: { id: 'p1', photos: ['a.jpg'] } } }, { id: 's2' }] as never)).toEqual({ s1: '/files/p1/a.jpg?thumb=400x300' });
});
